#!/usr/bin/env node
import { Construct } from 'constructs';
import { App, Stack, StackProps } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';

import { WindowsEKSCluster } from '../lib/eks_cluster_infrastructure';
import { WindowsEKSNodes } from '../lib/windows_eks_nodes';
import { WindowsFSxMad } from '../lib/aws-vpc-windows-fsx-mad';
import { WindowsWorker } from '../lib/windows_worker';

export class ExampleApp extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Step 1
    const vpc_infrasracture = new WindowsFSxMad(this, 'Main-Infra', {
      fsxSize: 200,
      fsxMbps: 128,
      multiAZ: true,
      fsxInPrivateSubnet: true,
      domainName: 'windowsoneks.aws',
    });

    // Step 2
    const eks_infra = new WindowsEKSCluster(this, 'EKS-Stack', vpc_infrasracture);

    // // Note: Enable windows support, create folder in the FSx filesystem

    // Step 3
    // const windows_worker = new WindowsWorker(this, 'WindowsWorker', {
    //   vpc: vpc_infrasracture.vpc,
    //   madObject: vpc_infrasracture.ad,
    //   iamManagedPoliciesList: [
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'),
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
    //   ],
    // });

    // windows_worker.runPsCommands(
    //   [
    //     `aws eks update-kubeconfig --name ${eks_infra.ekscluster.clusterName} --region ${process.env.CDK_DEFAULT_REGION}`,
    //     'mkdir c:\\kubectl',
    //     'wget -O C:\\kubectl\\kubectl.exe https://amazon-eks.s3.us-west-2.amazonaws.com/1.21.2/2021-07-05/bin/windows/amd64/kubectl.exe',
    //     '$env:Path += ";C:\\kubectl"',
    //   ],
    //   'installKubectl',
    // );

    // eks_infra.ekscluster.awsAuth.addMastersRole(windows_worker.worker_role);
    // // worker.openRDP('your-ip/32');

    // const windows_nodes = new WindowsEKSNodes(this, 'Windows-Nodes-Stack', vpc_infrasracture, eks_infra);
  }
}

const app = new App();
const cdk_props: StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
};

new ExampleApp(app, 'myApp01', cdk_props);
