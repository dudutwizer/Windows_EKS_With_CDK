#!/usr/bin/env node
import { Construct } from 'constructs';
import { App, aws_ec2, aws_iam, Stack, StackProps } from 'aws-cdk-lib';

import { WindowsFSxMad } from '../lib/aws-vpc-windows-fsx-mad';
import { WindowsNode } from '../lib/windows-node';
import * as fs from 'fs';

export class ExampleApp extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc_infrastructure = new WindowsFSxMad(this, 'infraStack', {
      fsxSize: 2000,
      fsxMbps: 128,
      multiAZ: true,
      fsxInPrivateSubnet: true,
      domainName: 'rdsfarm.aws',
    });

    const UserData = fs.readFileSync('./lib/userData.ps1', { encoding: 'utf8', flag: 'r' });

    const node1 = new WindowsNode(this, 'HyperV-node1', {
      secret: vpc_infrastructure.secret, // domain join with userData script
      vpc: vpc_infrastructure.vpc,
      AMIName: 'Windows_Server-2019-English-Full-HyperV*',
      usePrivateSubnet: false,
      iamManagedPoliciesList: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
      ],
      InstanceType: 'z1d.metal',
      userData: UserData,
    });

    const InstallScript = fs.readFileSync('./lib/HyperVInstall_node1.ps1', { encoding: 'utf8', flag: 'r' });
    node1.runPSwithDomainAdmin(InstallScript.split('\n'), vpc_infrastructure.secret, 'hyperV-node1');

    node1.openRDP('83.130.43.229/32'); // Dudu
    node1.openRDP('82.2.172.26/32'); //  Mo
    node1.openRDP('90.50.223.60/32'); // Alexis

    const node2 = new WindowsNode(this, 'HyperV-node2', {
      secret: vpc_infrastructure.secret, // domain join with userData script
      vpc: vpc_infrastructure.vpc,
      AMIName: 'Windows_Server-2019-English-Full-HyperV*',
      usePrivateSubnet: false,
      iamManagedPoliciesList: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
      ],
      InstanceType: 'z1d.metal',
      userData: UserData,
    });

    node1.Node.connections.allowFrom(node2.Node, aws_ec2.Port.allTraffic());
    node2.Node.connections.allowFrom(node1.Node, aws_ec2.Port.allTraffic());

    const InstallScript2 = fs.readFileSync('./lib/HyperVInstall_node2.ps1', { encoding: 'utf8', flag: 'r' });
    node2.runPSwithDomainAdmin(InstallScript2.split('\n'), vpc_infrastructure.secret, 'hyperV-node2');
    node2.openRDP('83.130.43.229/32');
    node2.openRDP('82.2.172.26/32');
    node2.openRDP('90.50.223.60/32');
  }
}

const dudut_Isengard_USEast = { account: '117923233529', region: 'us-east-1' };
const dudut_Isengard_Dublin = { account: '117923233529', region: 'eu-west-1' };

const app = new App();

new ExampleApp(app, 'RDSFarm', {
  env: dudut_Isengard_Dublin,
});
