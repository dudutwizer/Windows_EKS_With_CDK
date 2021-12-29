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

import { Construct } from 'constructs';
import { aws_iam as iam, aws_ec2 as ec2, aws_ssm as ssm, CfnOutput, aws_directoryservice as mad } from 'aws-cdk-lib';

/**
 * The properties for the WindowsWorker class.
 */
export interface WindowsWorkerProps {
  /**
   * The VPC to use <required>
   * @default - 'No default'.
   */
  vpc: ec2.IVpc;
  /**
   * IAM Instance role permissions
   * @default - 'AmazonSSMManagedInstanceCore, AmazonSSMDirectoryServiceAccess'.
   */
  iamManagedPoliciesList?: iam.IManagedPolicy[];
  /**
   * The EC2 Instance type to use
   *
   * @default - 'm5.2xlarge'.
   */
  InstanceType?: ec2.InstanceType;
  /**
   * Choose if to launch the instance in Private or in Public subnet
   * Private = Subnet that routes to the internet, but not vice versa.
   * Public = Subnet that routes to the internet and vice versa.
   * @default - Private.
   */
  usePrivateSubnet?: boolean;
  /**
   * Managed AD object to join the machine to (Will run SSM document with the directory ID)
   */
  madObject: mad.CfnMicrosoftAD;
}

/**
 * The WindowsWorker class.
 */
export class WindowsWorker extends Construct {
  readonly worker: ec2.Instance;
  readonly worker_role: iam.Role;

  constructor(scope: Construct, id = 'WindowsWorker', props: WindowsWorkerProps) {
    super(scope, id);
    props.iamManagedPoliciesList = props.iamManagedPoliciesList ?? [
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'),
    ];

    props.usePrivateSubnet = props.usePrivateSubnet ?? false;

    const machineImage = new ec2.LookupMachineImage({
      name: '*Windows_Server-2022-English-Full-Containers*',
      windows: true,
    });

    this.worker_role = new iam.Role(this, 'WindowsWorkerRole-' + id, {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: props.iamManagedPoliciesList,
    });

    const securityGroup = new ec2.SecurityGroup(this, 'WindowsWorkerSG', {
      vpc: props.vpc,
    });

    this.worker = new ec2.Instance(this, 'WindowsWorkerNode', {
      instanceType: props.InstanceType ?? new ec2.InstanceType('m5.large'),
      machineImage: machineImage,
      vpc: props.vpc,
      role: this.worker_role,
      securityGroup: securityGroup,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: props.usePrivateSubnet ? ec2.SubnetType.PRIVATE_WITH_NAT : ec2.SubnetType.PUBLIC,
        onePerAz: true,
      }),
    });

    new ssm.CfnAssociation(this, 'JoinADAssociation', {
      name: 'AWS-JoinDirectoryServiceDomain',
      parameters: {
        directoryId: [props.madObject.ref],
        directoryName: [props.madObject.name],
      },
      targets: [{ key: 'InstanceIds', values: [this.worker.instanceId] }],
    });

    new CfnOutput(this, 'Windows-Worker-Details', {
      value: `InstanceId: ${this.worker.instanceId}; dnsName: ${this.worker.instancePublicDnsName}`,
    });
  }

  /**
   * Running powershell scripts on the worker with SSM Document.
   * i.e: runPsCommands(["Write-host 'Hello world'", "Write-host 'Second command'"], "myScript")
   */
  runPsCommands(psCommands: string[], id: string) {
    new ssm.CfnAssociation(this, id, {
      name: 'AWS-RunPowerShellScript',
      parameters: {
        commands: psCommands,
      },
      targets: [{ key: 'InstanceIds', values: [this.worker.instanceId] }],
    });
  }
  /**
   * Open the security group of the worker machine to specific IP address on port 3389
   * i.e: openRDP("1.1.1.1/32")
   */
  openRDP(ipaddress: string) {
    this.worker.connections.allowFrom(ec2.Peer.ipv4(ipaddress), ec2.Port.tcp(3389), 'Allow RDP');
  }
}
