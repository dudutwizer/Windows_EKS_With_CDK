from aws_cdk import core
import aws_cdk.aws_ec2 as ec2
import aws_cdk.aws_secretsmanager as secretsmanager
import aws_cdk.aws_directoryservice as mad
import aws_cdk.aws_fsx as fsx
import json

class WindowsEksWithCdkStack(core.Stack):

    def __init__(self, scope: core.Construct, id: str,domain_name: str, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)
        ## VPC

        vpc = ec2.Vpc(self, "VPC", max_azs=2, cidr="10.10.0.0/16",
                            # This configuration will create 2 groups in 2 AZs = 4 subnets.
                            subnet_configuration=[
                                ec2.SubnetConfiguration(
                                    subnet_type=ec2.SubnetType.PUBLIC,
                                    name="Public",
                                    cidr_mask=24
                                    ),
                                ec2.SubnetConfiguration(
                                    subnet_type=ec2.SubnetType.PRIVATE,
                                    name="Private",
                                    cidr_mask=24
                                    )
                                ],
                            nat_gateways=2,
                            )

        ## Managed AD

        edition="Enterprise"
        
        domain_secret_manager_object = secretsmanager.Secret(self,id="SecretObjectForMAD",
                                            generate_secret_string=secretsmanager.SecretStringGenerator(
                                                secret_string_template=json.dumps({'Domain': domain_name, 'UserID': 'Admin'}),
                                                generate_string_key='password',
                                                exclude_punctuation=True,
                                            ),secret_name="ManagedAD-Admin-Password")
        
        domain_clear_text_secret = domain_secret_manager_object.secret_value_from_json('password').to_string()
        
        mad_object = mad.CfnMicrosoftAD(self,'MAD',
                                        name=domain_name,
                                        password=domain_clear_text_secret,
                                        vpc_settings=mad.CfnMicrosoftAD.VpcSettingsProperty(subnet_ids=vpc.select_subnets(subnet_type= ec2.SubnetType.PRIVATE).subnet_ids,vpc_id=vpc.vpc_id),
                                        edition=edition
                                        )
                                        
        mad_dns_ip1 = core.Fn.select(0,mad_object.attr_dns_ip_addresses) # Array[0]
        mad_dns_ip2 = core.Fn.select(1,mad_object.attr_dns_ip_addresses) # Array[1]

        dhcp = ec2.CfnDHCPOptions(self,
                            id,
                            domain_name=mad_object.name,
                            domain_name_servers=[mad_dns_ip1,mad_dns_ip2],
                            ntp_servers=["169.254.169.123"])
        
        ec2.CfnVPCDHCPOptionsAssociation(self, id="DHCP-OptionsSet-WithMAD",vpc_id=vpc.vpc_id, dhcp_options_id=dhcp.ref) ## Setting the VPC with the right DHCP Option set


        ## FSx 
        # Select two private subnets in a VPC 
        FSxSize = 500
        FSxMBps = 64

        subnets = vpc.select_subnets(subnet_type= ec2.SubnetType.PRIVATE).subnet_ids

        self.fsx = fsx.CfnFileSystem(self, id="FSx", file_system_type='WINDOWS',subnet_ids=subnets,
                                    windows_configuration=fsx.CfnFileSystem.WindowsConfigurationProperty(
                                                            active_directory_id=mad_object.ref,
                                                            throughput_capacity=FSxMBps,
                                                            preferred_subnet_id=subnets[0],
                                                            deployment_type="MULTI_AZ_1"
                                                            )
                                     ,storage_capacity=FSxSize)

        ## To-add here 
        ## ---EKS Workers
