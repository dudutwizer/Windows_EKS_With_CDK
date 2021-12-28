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
import {
  aws_directoryservice as mad,
  aws_ec2 as ec2,
  aws_route53resolver as r53resolver,
  aws_secretsmanager as secretsmanager,
  Fn,
} from 'aws-cdk-lib';
/**
 * The properties for the VpcMad class.
 */
export interface VpcMadProps {
  /**
   * The domain name for the Active Directory Domain.
   *
   * @default - 'domain.aws'.
   */
  domainName?: string;
  /**
   * The edition to use for the Active Directory Domain.
   * Allowed values: Enterprise | Standard
   * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-directoryservice-microsoftad.html#cfn-directoryservice-microsoftad-edition
   * @default - 'Standard'.
   */
  edition?: string;
  /**
   * The secrets manager secret to use must be in format:
   * '{Domain: <domain.name>, UserID: 'Admin', Password: '<password>'}'
   * @default - 'Randomly generated and stored in Secret Manager'.
   */
  secret?: secretsmanager.ISecret;
  /**
   * The VPC to use, must have private subnets.
   * @default - 'Randomly generated'.
   */
  vpc?: ec2.IVpc;
}
export class VpcMad extends Construct {
  readonly secret: secretsmanager.ISecret;
  readonly ad: mad.CfnMicrosoftAD;
  readonly CfnDHCPOptions: ec2.CfnDHCPOptions;
  readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id = 'aws-vpc-mad', props: VpcMadProps) {
    super(scope, id);
    props.domainName = props.domainName ?? 'domain.aws';
    props.edition = props.edition ?? 'Standard';
    this.vpc = props.vpc ?? new ec2.Vpc(this, id + '-VPC', { maxAzs: 2 });

    this.secret =
      props.secret ??
      new secretsmanager.Secret(this, id + '-Secret', {
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            Domain: props.domainName,
            UserID: 'Admin',
          }),
          generateStringKey: 'Password',
          excludePunctuation: true,
        },
        secretName: props.domainName + '-secret',
      });

    const subnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE,
    });

    this.ad = new mad.CfnMicrosoftAD(this, id + '-Mad', {
      password: this.secret.secretValueFromJson('Password').toString(),
      edition: props.edition,
      name: props.domainName,
      vpcSettings: {
        subnetIds: [subnets.subnetIds[0], subnets.subnetIds[1]],
        vpcId: this.vpc.vpcId,
      },
    });

    const sg = new ec2.SecurityGroup(this, id + 'OutboundResolverSG', {
      vpc: this.vpc,
    });
    sg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.udp(53));
    sg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(53));

    const outBoundResolver = new r53resolver.CfnResolverEndpoint(this, 'endpoint', {
      direction: 'OUTBOUND',
      ipAddresses: subnets.subnetIds.map((s) => {
        return { subnetId: s };
      }),
      securityGroupIds: [sg.securityGroupId],
    });

    const resolverRules = new r53resolver.CfnResolverRule(this, 'rules', {
      domainName: props.domainName,
      resolverEndpointId: outBoundResolver.ref,
      ruleType: 'FORWARD',
      targetIps: [{ ip: Fn.select(0, this.ad.attrDnsIpAddresses) }, { ip: Fn.select(1, this.ad.attrDnsIpAddresses) }],
    });

    new r53resolver.CfnResolverRuleAssociation(this, 'assoc', {
      resolverRuleId: resolverRules.attrResolverRuleId,
      vpcId: this.vpc.vpcId,
    });
  }
}
