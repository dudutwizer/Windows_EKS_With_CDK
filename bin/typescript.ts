#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import {
  WindowsEKSCluster,
  WindowsEKSNodes,
} from "../lib/eks_cluster_infrastructure";
import { WindowsFSxMad } from "../lib/aws-vpc-windows-fsx-mad";
import { WindowsWorker } from "../lib/windows_worker";
import * as iam from "@aws-cdk/aws-iam";

export class ExampleApp extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Step 1
    const vpc_infrasracture = new WindowsFSxMad(this, "Main-Infra", {
      fsxSize: 200,
      fsxMbps: 128,
      multiAZ: true,
      fsxInPrivateSubnet: true,
      domainName: "windowsoneks.aws",
    });

    // Step 2
    const eks_infra = new WindowsEKSCluster(
      this,
      "EKS-Stack",
      vpc_infrasracture
    );

    // // Note: Enable windows support, create folder in the FSx filesystem

    // Step 3
    const worker = new WindowsWorker(this, "WindowsWorker", {
      vpc: vpc_infrasracture.vpc,
      madObject: vpc_infrasracture.ad,
      iamManagedPoliciesList: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMDirectoryServiceAccess"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite"),
      ],
    });

    worker.openRDP("83.130.43.228/32")

    const windows_nodes = new WindowsEKSNodes(
      this,
      "Windows-Nodes-Stack",
      vpc_infrasracture,
      eks_infra
    );
  }
}

const app = new cdk.App();
const cdk_props: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
};

new ExampleApp(app, "myApp01", cdk_props);
