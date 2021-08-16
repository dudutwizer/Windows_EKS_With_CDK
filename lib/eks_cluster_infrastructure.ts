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
import * as cdk from '@aws-cdk/core';
import { WindowsFSxMad } from './aws-vpc-windows-fsx-mad';
import * as iam from '@aws-cdk/aws-iam';
import * as eks from '@aws-cdk/aws-eks';
import { CfnOutput } from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import autoscaling = require('@aws-cdk/aws-autoscaling');
import { CfnAssociation } from '@aws-cdk/aws-ssm';

export class WindowsEKSCluster extends cdk.Construct {
  readonly ekscluster: eks.Cluster;

  constructor(scope: cdk.Construct, id: string, vpc_infrasracture: WindowsFSxMad) {
    super(scope, id);

    const eks_role = new iam.Role(this, 'eks-instance-role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      roleName: 'eks-node-role' + id,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSKeyManagementServicePowerUser'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
      ],
    });

    this.ekscluster = new eks.Cluster(this, 'WindowsEKSCluster', {
      version: eks.KubernetesVersion.V1_21,
      vpc: vpc_infrasracture.vpc,
    });

    this.ekscluster.awsAuth.addRoleMapping(eks_role, {
      groups: ['system:bootstrappers', 'system:nodes'],
      username: 'system:node:{{EC2PrivateDNSName}}',
    });

    new CfnOutput(this, 'K8sMapRolesReminder', {
      value: `If you are using IAM roles, please run 'kubectl edit cm -n kube-system aws-auth' and add your IAM role to mapRoles`,
    });
    new CfnOutput(this, 'WindowsSupport', {
      value: `please run 'eksctl utils install-vpc-controllers --cluster ${this.ekscluster.clusterName}' to install windows support`,
    });
  }
}
