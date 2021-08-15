import * as cdk from "@aws-cdk/core";
import { WindowsFSxMad } from "./aws-vpc-windows-fsx-mad";
import * as iam from "@aws-cdk/aws-iam";
import * as eks from "@aws-cdk/aws-eks";
import { CfnOutput } from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import autoscaling = require("@aws-cdk/aws-autoscaling");
import { CfnAssociation, CfnDocument } from "@aws-cdk/aws-ssm";

export class WindowsEKSCluster extends cdk.Construct {
  readonly ekscluster: eks.Cluster;

  constructor(
    scope: cdk.Construct,
    id: string,
    vpc_infrasracture: WindowsFSxMad
  ) {
    super(scope, id);

    const eks_role = new iam.Role(this, "eks-instance-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      roleName: "eks-node-role"+id,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEC2ContainerRegistryReadOnly"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMDirectoryServiceAccess"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AWSKeyManagementServicePowerUser"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSClusterPolicy"),
      ],
    });

    this.ekscluster = new eks.Cluster(this, "WindowsEKSCluster", {
      version: eks.KubernetesVersion.V1_21,
      vpc: vpc_infrasracture.vpc,
    });

    this.ekscluster.awsAuth.addRoleMapping(eks_role, {
      groups : [
        "system:bootstrappers",
        "system:nodes",
      ],
      username: "system:node:{{EC2PrivateDNSName}}",
    });


    new CfnOutput(this, "K8sMapRolesReminder", {
      value: `If you are using IAM roles, please run 'kubectl edit cm -n kube-system aws-auth' and add your IAM role to mapRoles`,
    });
    new CfnOutput(this, "WindowsSupport", {
      value: `please run 'eksctl utils install-vpc-controllers --cluster ${this.ekscluster.clusterName}' to install windows support`,
    });
  }
}

export class WindowsEKSNodes extends cdk.Construct {
  readonly windowsNodesASG: autoscaling.AutoScalingGroup;

  constructor(
    scope: cdk.Construct,
    id: string,
    vpc_infrasracture: WindowsFSxMad,
    windowsEKSCluster: WindowsEKSCluster
  ) {
    super(scope, id);
    const windows_machineImage = new ec2.LookupMachineImage({
      name: "*Windows_Server-2019-English-Full-EKS_Optimized-1.20*",
      windows: true,
    });

    const eks_security_group = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "SG",
      windowsEKSCluster.ekscluster.clusterSecurityGroupId
    );

    const windows_workers_role = new iam.Role(
      this,
      "windows-eks-workers-instance-role",
      {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        roleName: "windows-eks-workers-instance-role",
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMManagedInstanceCore"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonEKSWorkerNodePolicy"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonEC2ContainerRegistryReadOnly"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMDirectoryServiceAccess"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "AWSKeyManagementServicePowerUser"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSClusterPolicy"),
          iam.ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite"),
        ],
      }
    );

    windowsEKSCluster.ekscluster.awsAuth.addRoleMapping(windows_workers_role, {
      groups : [
        "system:bootstrappers",
        "system:nodes",
        "eks:kube-proxy-windows"
      ],
      username: "system:node:{{EC2PrivateDNSName}}",
    });

    this.windowsNodesASG = new autoscaling.AutoScalingGroup(
      this,
      "WindowsInstancesCapacity",
      {
        vpc: vpc_infrasracture.vpc,
        role: windows_workers_role,
        minCapacity: 2,
        securityGroup: eks_security_group,
        maxCapacity: 10,
        instanceType: new ec2.InstanceType("m5.xlarge"),
        machineImage: windows_machineImage,
      }
    );

    const asgResource = this.windowsNodesASG.node.children.find(
      (c) =>
        (c as cdk.CfnResource).cfnResourceType ===
        "AWS::AutoScaling::AutoScalingGroup"
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
    `)

    new CfnAssociation(this, "SMBGlobalMappingAndEKSJoin", {
      name: "AWS-RunPowerShellScript",
      parameters: {
        commands: [
            "$bootfix = {",
            "$LocalDrive = Get-SmbGlobalMapping",
            "if ($LocalDrive -eq $null)",
            "{",
            ` [string]$SecretAD  = '${vpc_infrasracture.secret.secretName}'`,
            " $SecretObj = Get-SECSecretValue -SecretId $SecretAD",
            " [PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)",
            " $password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force",
            " $username   = $Secret.UserID + '@' + $Secret.Domain",
            " $domain_admin_credential = New-Object System.Management.Automation.PSCredential($username,$password)",
            ` New-SmbGlobalMapping -RemotePath '\\\\${vpc_infrasracture.fsx.getAtt(
              "DNSName"
            )}\\ContainerStorage' -Credential $domain_admin_credential -LocalPath G: -Persistent $true -RequirePrivacy $true -ErrorAction Stop`,
            "}",
            "}",
            "New-Item -ItemType Directory -Path c:\\Scripts",
            "$bootfix | set-content c:\\Scripts\\bootfix.ps1",
            "# Create a scheduled task on startup to execute the mapping",
            "$action = New-ScheduledTaskAction -Execute 'Powershell.exe' -Argument 'c:\\scripts\\bootfix.ps1'",
            "$trigger =  New-ScheduledTaskTrigger -AtStartup",
            "Register-ScheduledTask -Action $action -Trigger $trigger -TaskName 'SmbGlobalMapping' -Description 'Mapping the SMB share and adding machine to gMSA' -RunLevel Highest -User $username -Password $Secret.Password",
            "# Running the boot fix once",
            "& $bootfix",
            "# Joining EKS Cluster",
            "[string]$EKSBootstrapScriptFile = 'C:\\Program Files\\Amazon\\EKS\\Start-EKSBootstrap.ps1'",
            `powershell -File $EKSBootstrapScriptFile -EKSClusterName '${windowsEKSCluster.ekscluster.clusterName}'`,
            "",
        ],
      },
      targets: [
        {
          key: "tag:aws:autoscaling:groupName",
          values: [this.windowsNodesASG.autoScalingGroupName],
        },
      ],
    });

    new CfnAssociation(this, "gMSASpecFile", {
      name: "AWS-RunPowerShellScript",
      parameters: {
        commands: [
          "# Getting AD Password",
            `[string]$SecretAD  = '${vpc_infrasracture.secret.secretName}'`,
            "$SecretObj = Get-SECSecretValue -SecretId $SecretAD",
            "[PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)",
            "$password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force",
            "$username   = $Secret.UserID + '@' + $Secret.Domain",
            "$domain_admin_credential = New-Object System.Management.Automation.PSCredential($username,$password)",
            "Add-WindowsFeature RSAT-AD-PowerShell",
            "Install-PackageProvider NuGet -Force",
            "Install-Module CredentialSpec",
            "Set-PSRepository PSGallery -InstallationPolicy Trusted",
            "Add-ADGroupMember -Identity 'WebApp01Hosts' -Members $env:computername$ -Credential $domain_admin_credential",
            "# Saves the cred file to C:\\ProgramData\\Docker\\CredentialSpecs (default)",
            "$bootfix = {",
              "New-CredentialSpec -AccountName WebApp01",
            "}",
            "# Running the boot fix once",
            "& $bootfix",
            "# Scheduling onboot",
            "$trigger =  New-ScheduledTaskTrigger -AtStartup",
            "Register-ScheduledTask -Action $action -Trigger $trigger -TaskName 'CreateCredSpecFile' -Description 'CreateCredFile and saves it in default folder' -RunLevel Highest -User $username -Password $Secret.Password",
            "",
        ],
      },
      targets: [
        {
          key: "tag:aws:autoscaling:groupName",
          values: [this.windowsNodesASG.autoScalingGroupName],
        },
      ],
    });

    windowsEKSCluster.ekscluster.connectAutoScalingGroupCapacity(
      this.windowsNodesASG,
      {
        bootstrapEnabled: false,
      }
    );
  }
}
