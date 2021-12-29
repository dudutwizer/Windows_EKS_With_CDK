#!/usr/bin/env node
import { Construct } from 'constructs';
import { App, aws_ec2, Stack, StackProps } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';

import { WindowsEKSCluster } from '../lib/eks_cluster_infrastructure';
import { WindowsEKSNodes } from '../lib/windows_eks_nodes';
import { WindowsFSxMad } from '../lib/aws-vpc-windows-fsx-mad';
import { WindowsWorker } from '../lib/windows_worker';

export class ExampleApp extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Step 1
    const vpc_infrastructure = new WindowsFSxMad(this, 'Main-Infra', {
      fsxSize: 200,
      fsxMbps: 128,
      multiAZ: true,
      fsxInPrivateSubnet: true,
      domainName: 'windowsoneks.aws',
    });

    // Step 2
    const eks_infra = new WindowsEKSCluster(this, 'EKS-Stack', vpc_infrastructure);

    // Step 3
    const windows_worker = new WindowsWorker(this, 'WindowsWorker', {
      vpc: vpc_infrastructure.vpc,
      madObject: vpc_infrastructure.ad,
      iamManagedPoliciesList: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
      ],
    });

    // Kubernetes 1.21 kubectl
    windows_worker.runPsCommands(
      [
        `aws eks update-kubeconfig --name ${eks_infra.ekscluster.clusterName} --region ${process.env.CDK_DEFAULT_REGION}`,
        'mkdir c:\\kubectl',
        'wget -O C:\\kubectl\\kubectl.exe https://amazon-eks.s3.us-west-2.amazonaws.com/1.21.2/2021-07-05/bin/windows/amd64/kubectl.exe',
        '$env:Path += ";C:\\kubectl"',
      ],
      'installKubectl',
    );

    eks_infra.ekscluster.awsAuth.addMastersRole(windows_worker.worker_role);
    eks_infra.ekscluster.connections.allowFrom(windows_worker.worker, aws_ec2.Port.tcp(443));
    windows_worker.openRDP('83.130.43.230/32');

    // Note: Please enable windows support and create folder in the FSx filesystem before deploying the Nodes.

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
