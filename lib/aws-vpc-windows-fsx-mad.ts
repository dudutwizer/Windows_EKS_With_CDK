import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as fsx from "@aws-cdk/aws-fsx";
import { VpcMad, VpcMadProps } from "./aws-vpc-mad";
import { CfnFileSystemProps } from "@aws-cdk/aws-fsx";

/**
 * The properties for the WindowsFSxMad class.
 */
export interface WindowsFSxMadProps extends VpcMadProps {
  fsxSize?: number;
  fsxMbps?: number;
  multiAZ?: boolean;
  fsxInPrivateSubnet?: boolean;
}

export class WindowsFSxMad extends VpcMad {
  readonly fsx: fsx.CfnFileSystem;
  constructor(
    scope: cdk.Construct,
    id: string = "aws-vpc-mad-fsx",
    props: WindowsFSxMadProps
  ) {
    super(scope, id, props);
    props.fsxInPrivateSubnet = props.fsxInPrivateSubnet ?? true;
    props.fsxMbps = props.fsxMbps ?? 128;
    props.fsxSize = props.fsxSize ?? 200;
    props.multiAZ = props.multiAZ ?? true;

    const subnets = this.vpc.selectSubnets({
      subnetType: props.fsxInPrivateSubnet
        ? ec2.SubnetType.PRIVATE
        : ec2.SubnetType.PUBLIC,
    }).subnetIds;

    const windows_configuration: fsx.CfnFileSystem.WindowsConfigurationProperty =
      {
        throughputCapacity: props.fsxMbps,
        activeDirectoryId: this.ad.ref,
        deploymentType: props.multiAZ ? "MULTI_AZ_1" : "SINGLE_AZ_2",
        preferredSubnetId: props.multiAZ ? subnets[0] : undefined,
      };

    const sg = new ec2.SecurityGroup(this, id + "FSxSG", {
      vpc: this.vpc,
    });
    sg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.allTcp());

    const fsx_props: CfnFileSystemProps = {
      fileSystemType: "WINDOWS",
      subnetIds: props.multiAZ ? [subnets[0], subnets[1]] : [subnets[0]],
      windowsConfiguration: windows_configuration,
      storageCapacity: props.fsxSize,
      securityGroupIds: [sg.securityGroupId],
    };

    this.fsx = new fsx.CfnFileSystem(this, (id = "FSx"), fsx_props);
  }
}
