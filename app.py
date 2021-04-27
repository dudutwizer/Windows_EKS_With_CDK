#!/usr/bin/env python3

from aws_cdk import core

from windows_eks_with_cdk.windows_eks_with_cdk_stack import WindowsEksWithCdkStack

env_EU = core.Environment(account='075808977365', region='eu-west-1')
app = core.App()

WindowsEksWithCdkStack(app, id="windows-eks-with-cdk", domain_name="eks-domain.aws", env=env_EU)

app.synth()
