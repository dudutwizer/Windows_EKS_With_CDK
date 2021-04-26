#!/usr/bin/env python3

from aws_cdk import core

from windows_eks_with_cdk.windows_eks_with_cdk_stack import WindowsEksWithCdkStack


app = core.App()
WindowsEksWithCdkStack(app, "windows-eks-with-cdk")

app.synth()
