import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import { CfnAssociation, CfnDocument } from "@aws-cdk/aws-ssm";
import { IManagedPolicy } from "@aws-cdk/aws-iam";
import * as iam from "@aws-cdk/aws-iam";
import * as mad from "@aws-cdk/aws-directoryservice";
import { version } from "process";
import { SecurityGroup } from "@aws-cdk/aws-ec2";

export class WindowsWorker extends cdk.Construct {
  readonly worker: ec2.Instance;
  constructor(
    scope: cdk.Construct,
    id = "WindowsWorker",
    props: WindowsWorkerProps
  ) {
    super(scope, id);
    props.iamManagedPoliciesList = props.iamManagedPoliciesList ?? [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMManagedInstanceCore"
      ),
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMDirectoryServiceAccess"
      )
    ];

    props.usePrivateSubnet = props.usePrivateSubnet ?? false;

    const ami_id = new ec2.WindowsImage(
      ec2.WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE
    );

    const role = new iam.Role(this, "WindowsWorkerRole-" + id, {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: props.iamManagedPoliciesList,
    });

    const securityGroup = new SecurityGroup(this, "intanceWorkerSG", {
      vpc: props.vpc,
    });

    this.worker = new ec2.Instance(this, "Workernode", {
      instanceType: props.InstanceType ?? new ec2.InstanceType("m5.2xlarge"),
      machineImage: ami_id,
      vpc: props.vpc,
      role: role,
      securityGroup: securityGroup,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: props.usePrivateSubnet
          ? ec2.SubnetType.PRIVATE
          : ec2.SubnetType.PUBLIC,
        onePerAz: true,
      }),
    });

    let worker_linux = new ec2.Instance(this, "WorkerLinuxnode", {
      instanceType: props.InstanceType ?? new ec2.InstanceType("m5.2xlarge"),
      machineImage: new ec2.AmazonLinuxImage,
      vpc: props.vpc,
      role: role,
      securityGroup: securityGroup,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: props.usePrivateSubnet
          ? ec2.SubnetType.PRIVATE
          : ec2.SubnetType.PUBLIC,
        onePerAz: true,
      }),
    });
    new CfnAssociation(this, "JoinADAssociation", {
      name: "AWS-JoinDirectoryServiceDomain",
      parameters: {
        directoryId: [props.madObject.ref],
        directoryName: [props.madObject.name],
      },
      targets: [{ key: "InstanceIds", values: [this.worker.instanceId] }],
    });

    new cdk.CfnOutput(this, "CfnOutputWindowsWorker", {
      value: this.worker.instancePublicDnsName,
    });
  }

  runPsCommands(psCommands: string[], id: string) {
    new CfnAssociation(this, id, {
      name: "AWS-RunPowerShellScript",
      parameters: {
        commands: psCommands,
      },
      targets: [{ key: "InstanceIds", values: [this.worker.instanceId] }],
    });
  }
  
  openRDP(ipaddress: string){
    this.worker.connections.allowFrom(ec2.Peer.ipv4(ipaddress), ec2.Port.tcp(3389), "Allow RDP")
  }
}

export interface WindowsWorkerProps {
  /**
   * The VPC to use <required>
   * @default - 'No default'.
   */
  vpc: ec2.IVpc;
  /**
   * Powershell Commands to execute
   * @default - 'No default'.
   */
  iamManagedPoliciesList?: IManagedPolicy[];
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
   * Managed AD object to joint to
   */
  madObject: mad.CfnMicrosoftAD;
}
