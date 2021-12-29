/**
 *  Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

// Imports
import { Construct } from 'constructs';
import { aws_iam as iam, aws_ec2 as ec2, aws_autoscaling as autoscaling, aws_ssm as ssm, CfnResource } from 'aws-cdk-lib';
import { WindowsFSxMad } from './aws-vpc-windows-fsx-mad';
import { WindowsEKSCluster } from './eks_cluster_infrastructure';

export class WindowsEKSNodes extends Construct {
  readonly windowsNodesASG: autoscaling.AutoScalingGroup;

  constructor(scope: Construct, id: string, vpc_infrasracture: WindowsFSxMad, windowsEKSCluster: WindowsEKSCluster) {
    super(scope, id);
    const windows_machineImage = new ec2.LookupMachineImage({
      name: '*Windows_Server-2019-English-Full-EKS_Optimized-1.21*',
      windows: true,
    });

    const eks_security_group = ec2.SecurityGroup.fromSecurityGroupId(this, 'SG', windowsEKSCluster.ekscluster.clusterSecurityGroupId);

    const windows_workers_role = new iam.Role(this, 'windows-eks-workers-instance-role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      roleName: 'windows-eks-workers-instance-role',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSKeyManagementServicePowerUser'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
      ],
    });

    windowsEKSCluster.ekscluster.awsAuth.addRoleMapping(windows_workers_role, {
      groups: ['system:bootstrappers', 'system:nodes', 'eks:kube-proxy-windows'],
      username: 'system:node:{{EC2PrivateDNSName}}',
    });

    this.windowsNodesASG = new autoscaling.AutoScalingGroup(this, 'WindowsInstancesCapacity', {
      vpc: vpc_infrasracture.vpc,
      role: windows_workers_role,
      minCapacity: 2,
      securityGroup: eks_security_group,
      maxCapacity: 10,
      instanceType: new ec2.InstanceType('m5.xlarge'),
      machineImage: windows_machineImage,
    });

    const asgResource = this.windowsNodesASG.node.children.find(
      (c) => (c as CfnResource).cfnResourceType === 'AWS::AutoScaling::AutoScalingGroup',
    ) as autoscaling.CfnAutoScalingGroup;

    this.windowsNodesASG.addUserData(`
  
      #domain join with secret from secret manager
      [string]$SecretAD  = "${vpc_infrasracture.secret.secretName}"
      $SecretObj = Get-SECSecretValue -SecretId $SecretAD
      [PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)
      $password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force
      $username   = $Secret.UserID + "@" + $Secret.Domain
      $credential = New-Object System.Management.Automation.PSCredential($username,$password)
      Add-Computer -DomainName $Secret.Domain -Credential $credential
  
      Restart-Computer -Force
      `);

    new ssm.CfnAssociation(this, 'SMBGlobalMappingAndEKSJoin', {
      name: 'AWS-RunPowerShellScript',
      parameters: {
        commands: [
          '$bootfix = {',
          '$LocalDrive = Get-SmbGlobalMapping',
          'if ($LocalDrive -eq $null)',
          '{',
          ` [string]$SecretAD  = '${vpc_infrasracture.secret.secretName}'`,
          ' $SecretObj = Get-SECSecretValue -SecretId $SecretAD',
          ' [PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)',
          ' $password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force',
          " $username   = $Secret.UserID + '@' + $Secret.Domain",
          ' $domain_admin_credential = New-Object System.Management.Automation.PSCredential($username,$password)',
          ` New-SmbGlobalMapping -RemotePath '\\\\${vpc_infrasracture.fsx.getAtt(
            'DNSName',
          )}\\ContainerStorage' -Credential $domain_admin_credential -LocalPath G: -Persistent $true -RequirePrivacy $true -ErrorAction Stop`,
          '}',
          '}',
          'New-Item -ItemType Directory -Path c:\\Scripts',
          '$bootfix | set-content c:\\Scripts\\bootfix.ps1',
          '# Create a scheduled task on startup to execute the mapping',
          "$action = New-ScheduledTaskAction -Execute 'Powershell.exe' -Argument 'c:\\scripts\\bootfix.ps1'",
          '$trigger =  New-ScheduledTaskTrigger -AtStartup',
          "Register-ScheduledTask -Action $action -Trigger $trigger -TaskName 'SmbGlobalMapping' -Description 'Mapping the SMB share and adding machine to gMSA' -RunLevel Highest -User $username -Password $Secret.Password",
          '# Running the boot fix once',
          '& $bootfix',
          '# Joining EKS Cluster',
          "[string]$EKSBootstrapScriptFile = 'C:\\Program Files\\Amazon\\EKS\\Start-EKSBootstrap.ps1'",
          `powershell -File $EKSBootstrapScriptFile -EKSClusterName '${windowsEKSCluster.ekscluster.clusterName}'`,
          '',
        ],
      },
      targets: [
        {
          key: 'tag:aws:autoscaling:groupName',
          values: [this.windowsNodesASG.autoScalingGroupName],
        },
      ],
    });

    new ssm.CfnAssociation(this, 'gMSASpecFile', {
      name: 'AWS-RunPowerShellScript',
      parameters: {
        commands: [
          '# Getting AD Password',
          `[string]$SecretAD  = '${vpc_infrasracture.secret.secretName}'`,
          '$SecretObj = Get-SECSecretValue -SecretId $SecretAD',
          '[PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)',
          '$password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force',
          "$username   = $Secret.UserID + '@' + $Secret.Domain",
          '$domain_admin_credential = New-Object System.Management.Automation.PSCredential($username,$password)',
          'Add-WindowsFeature RSAT-AD-PowerShell',
          'Install-PackageProvider NuGet -Force',
          'Install-Module CredentialSpec',
          'Set-PSRepository PSGallery -InstallationPolicy Trusted',
          "Add-ADGroupMember -Identity 'WebApp01Hosts' -Members $env:computername$ -Credential $domain_admin_credential",
          '# Saves the cred file to C:\\ProgramData\\Docker\\CredentialSpecs (default)',
          '$bootfix = {',
          'New-CredentialSpec -AccountName WebApp01',
          '}',
          '# Running the boot fix once',
          '& $bootfix',
          '# Scheduling onboot',
          '$trigger =  New-ScheduledTaskTrigger -AtStartup',
          "Register-ScheduledTask -Action $action -Trigger $trigger -TaskName 'CreateCredSpecFile' -Description 'CreateCredFile and saves it in default folder' -RunLevel Highest -User $username -Password $Secret.Password",
          '',
        ],
      },
      targets: [
        {
          key: 'tag:aws:autoscaling:groupName',
          values: [this.windowsNodesASG.autoScalingGroupName],
        },
      ],
    });

    windowsEKSCluster.ekscluster.connectAutoScalingGroupCapacity(this.windowsNodesASG, {
      bootstrapEnabled: false,
    });
  }
}
