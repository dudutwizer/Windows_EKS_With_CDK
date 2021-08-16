# EKS With Windows Nodes integrated with Active Directory and Shared Storage (Amazon FSx)

## Architecture

![Architecture.png](Screenshots/General.png)

## How to use the code

```bash
git clone <repoURL>

# Install dependencies
npm install

# Run the code and create cloudformation templates
cdk ls 

# Make the relevent code changes

# Deploy the code
cdk deploy
```

## CDK Constructs 

**VpcMad**

This construct creates Amazon VPC, Amazon Managed AD, Secret for the domain Admin stored in Secrets Manager and Route 53 forward rule for the domain.

The construct provides way to customize configuration and smart defaults for the infrastructures.

Example:

```typescript
const vpc_infrasracture = new VpcMad(this, "Main-Infra", { domain_name: "windowseks.aws"});
```

**WindowsFSxMad**

This construct extends the VpcMad to allow FSx integration.

Example:

```typescript
const vpc_infrasracture = new WindowsFSxMad(this, "Main-Infra", {
	FSxMBps: 128, 
	FSxSize: 100, 
	MultiAZ: false, 
	FSxInPrivateSubnet: true, 
	domain_name: "windowseks.aws"
});
```

**WindowsEKSCluster** 

This stack take the WindowsFSxMad stack as input and creates the EKS cluster with permissions to operate EKS clusters.

Example:

```typescript
const eks_infra = new WindowsEKSCluster(this, 'EKS-Infra',vpc_infrasracture);
```

**WindowsEKSNodes**

The stack creates the Windows Autoscaling group with domain join script and the SSM Documents for gMSA and Global Mapping.

Example:

```typescript
const eks_nodes = new WindowsEKSNodes(this, 'EKS-Nodes',
	vpc_infrasracture, 
	eks_infra);
```

**WindowsWorker**

The stack creates Windows Server with the latest AMI and joined the machine to the domain. It is possible to send Powershell commands or connect and work from the machine. 

Example:

```typescript
const Worker = new WindowsWorker(this, 'WindowsWorker',{
	vpc: vpc_infrasracture.vpc, 
	madObject: vpc_infrasracture.ad);
```

# Automation

The steps in high level (the manual steps are `marked`):

1. Infrastructure
	- VPC
	- Managed AD
	- Secret Manager
	- Create Amazon FSx in two Availability zones
	- `Create the gMSA Account in the AD`
	- `Create a dedicated folder on the FSx for the SMB Share with the AD gMSA`
	- Route 53 Resolver
2. Infrastructure customization
	- Create EKS Cluster
	- Deploy two Linux machines in NodeGroup
	- Configure Permissions & Roles (IAM Roles)
	- K8s groups to the EC2 Instance
	- `Installing eksctl on local machine`
	- `Map IAM Users to mapRoles`
	- `Enable Windows Support with eksctl`
3. Adding Capacity
	- Configure Launch Template
	- Create Autoscaling Group
	- Connect the Instances to the Domain
	- Map the CIFS to the host with Global Mapping
	- Connect the Nodes to the EKS Cluster
	- Connect the ASG to the Cluster
4. Scheduling Pods
	- `Deployment Yaml`
	- `Service Yaml`

[Full Installation guide](Installation_guide.md)
