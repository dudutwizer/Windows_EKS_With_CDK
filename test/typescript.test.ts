import { App, aws_iam, Stack } from 'aws-cdk-lib';
// import { ExampleApp } from "../src/ExampleApp/app";
import { WindowsNode } from '../lib/windows-node';
import { WindowsFSxMad } from '../lib/aws-vpc-windows-fsx-mad';
import * as fs from 'fs';

test('ExampleApp', () => {
  const env = {
    account: '1111111111',
    region: 'us-east-1',
  };
  const app = new App();
  const stack = new Stack(app, 'test', { env: env });
  const vpc_infrastructure = new WindowsFSxMad(stack, 'infraStack', {
    fsxSize: 2000,
    fsxMbps: 128,
    multiAZ: true,
    fsxInPrivateSubnet: true,
    domainName: 'rdsfarm.aws',
  });
  const UserData = fs.readFileSync('./lib/userData.ps1', { encoding: 'utf8', flag: 'r' });
  const node2 = new WindowsNode(stack, 'HyperV-node2', {
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

  const InstallScript = fs.readFileSync('./lib/HyperVInstall_node2.ps1', { encoding: 'utf8', flag: 'r' });
  node2.runPSwithDomainAdmin(InstallScript.split('\n'), vpc_infrastructure.secret, 'hyperV-node2');

  expect(node2).toHaveProperty('node');
});
