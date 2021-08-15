# EKS With Windows Nodes integrated with Active Directory and Shared Storage (Amazon FSx)

**VpcMad**

This construct creates Amazon VPC, Managed AD, Secret for the domain Admin stored in SSM and Route 53 resolvers for the domain,

The construct provides way to customize configuration and smart defaults for the infrastructures.

Example:

```typescript
const vpc_infrasracture = new VpcMad(this, "Main-Infra", { domain_name: "windowseks.aws"});
```

**WindowsFSxMad**

This construct extends the VpcMad to allow FSx integration.

Example:

```typescript
const vpc_infrasracture = new WindowsFSxMad(this, "Main-Infra", {FSxMBps: 128, FSxSize: 100, MultiAZ: false, FSxInPrivateSubnet:true, domain_name: "windowseks.aws"});
```

**WindowsEKSCluster** 

This stack consumes the WindowsFSxMad stack and creates the EKS cluster with all the deployment, service and the necessary permissions to operate EKS clusters.

Example:

```typescript
const eks_infra = new WindowsEKSCluster(this, 'EKS-Infra',vpc_infrasracture);
```

**WindowsEKSNodes**

The stack creates the Windows Autoscaling group with the relevant 

Example:

`const eks_nodes = new WindowsEKSNodes(this, 'EKS-Nodes’,vpc_infrasracture, eks_infra);`

**WindowsWorker**

The stack creates Windows Server with the latest AMI and joined the machine to the domain. It is possible to send Powershell commands or connect and work from the machine. 

Example:

`const Worker = new WindowsWorker(this, ‘WindowsWorker’,{vpc: vpc_infra.vpc, madObject: vpc_infra.ad);
`


## Installation guide

There are manual steps that need to be executed between the installation of the different components

## Installation steps 

- Step 1: Deploying the basic cloud infrastructure
- Step 2: Customize the infrastructure
- Step 3: Deploying the EKS Cluster
- Step 4: Adding local permissions to kubectl
- Step 5: Configure the FSx and the gMSA accounts
- Step 6: Deploying Windows autoscaling group
- Step 7: Scheduling pods

To avoid over-complicated multi-step automation solution for now, this guide explains how to use simple workaround (comment out and comment in).

The steps in high level (the manual steps are `marked`):

1. Infrastructure
	- VPC
	- Managed AD
	- Secret Manager
	- Amazon FSx
	- `Create gMSA Account`
	- `Create a dedicated folder on the FSx for the SMB Share with the AD gMSA`
	- Route 53 Resolver
2. Infrastructure customization
	- EKS Cluster
	- Permissions & Roles
	- k8s groups
	- `Installing eksctl`
	- `Mapping IAM Roles to mapRoles`
	- `Enabling Windows Support with eksctl`
3. Adding Capacity
	- Configuration Launch Template
	- Creating Autoscaling Group
	- Connect the Instances to the Domain
	- Map the CIFS to the host
	- Connect the Nodes to the EKS Cluster
	- Connect the ASG to the Cluster
4. Scheduling Pods
	- `Deployment Yaml`
	- `Service Yaml`
	
            

**Step 1: Deploying the basic cloud infrastructure:**

Edit the typescript.ts file and comment out the eks_infra object and the windows nodes object. This way the app will launch only the VPC, MAD, FSx, and the R53. This will take 50 minutes.
```typescript
 const vpc_infrasracture = new WindowsFSxMad(this, "Main-Infra", {
	 fsxSize: 200,
	 fsxMbps: 128,
	 multiAZ: true,
	 fsxInPrivateSubnet: true,
	 domainName: "windowseks.aws",
 });

 // const eks_infra = new WindowsEKSCluster(
 // this,
 // "EKS-Stack",
 // vpc_infrasracture
 // );
 // const worker = new WindowsWorker(this, "WindowsWorker", {
 // vpc: vpc_infrasracture.vpc,
 // madObject: vpc_infrasracture.ad,
 // iamManagedPoliciesList: [
 // iam.ManagedPolicy.fromAwsManagedPolicyName(
 // "AmazonSSMManagedInstanceCore"
 // ),
 // iam.ManagedPolicy.fromAwsManagedPolicyName(
 // "AmazonSSMDirectoryServiceAccess"
 // ),
 // iam.ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite"),
 // ],
 // });
 // const windows_nodes = new WindowsEKSNodes(
 // this,
 // "Windows-Nodes-Stack",
 // vpc_infrasracture,
 // eks_infra
 // );
 // }
 ```

Launch the CDK code

`cdk deploy --all`

**Step 2: Customize the infrastructure:**

Review the resources deployed (FSx, Amazon MAD etc) and make the relevant infrastructure changes (Domain Trust, user-accounts if needed, 3rd party storage solution, etc)

**Step 3: Deploying the EKS Cluster:**

Now, uncomment the eks_infra object

```typescript
const eks_infra = new WindowsEKSCluster(
 this,
 "EKS-Stack",
 vpc_infrasracture
 );
```
And deploy the CDK APP again with the following command:

`cdk deploy --all`

***Note: CDK will only deploy the changes and will not re-deploy everything.**

At this step the EKS cluster is created and there are no nodes/workers configured.

**Step 4: Adding local permissions to kubectl**

Grant local permissions:
From the output of the CDK run the commands

![](./Screenshots/Pasted%20image%2020210802181109.png)

```typescript
aws eks update-kubeconfig --name <cluster-name> --region us-east-1 --role-arn <role-arn>
```

Now kubectl should work on your local machine, configured with the EKS cluster.

<Optional> Map IAM Role to the mapRoles (see [guide](https://docs.aws.amazon.com/eks/latest/userguide/add-user-role.html))

`kubectl edit cm -n kube-system aws-auth`
	
example:

![](./Screenshots/Pasted%20image%2020210802181125.png)

<Required> [Install eksctl](https://docs.aws.amazon.com/eks/latest/userguide/eksctl.html) from on your machine and enable Windows Support on the cluster:

  
```bash
eksctl utils install-vpc-controllers --cluster <cluster-name> --approve  
kubectl rollout restart deployment -n kube-system vpc-admission-webhook```
```

At this stage, the cluster is ready to add Windows Nodes.
	
**Step 5: Configure the FSx and the gMSA accounts**

Login to the Worker Machine with domain account (get the password from Secrets Manager).

Run elevated Powershell.
	
**Create gMSA account**
	
```powershell
# Replace 'WebApp01' and 'windowsoneks.aws' with your own gMSA and domain names, respectively

[string]$SecretAD  = 'windowsoneks.aws-secret'
$SecretObj = Get-SECSecretValue -SecretId $SecretAD
[PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)
$password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force
$username   = $Secret.UserID + '@' + $Secret.Domain
$domain_admin_credential = New-Object System.Management.Automation.PSCredential($username,$password) 

Install-Module powershell-yaml
Add-WindowsFeature RSAT-AD-PowerShell
Install-Module CredentialSpec

# Create the security group
New-ADGroup -Name "WebApp01 Authorized Hosts" -SamAccountName "WebApp01Hosts" -GroupScope DomainLocal

# Create the gMSA
New-ADServiceAccount -Name "WebApp01" -DnsHostName "WebApp01.windowsoneks.aws" -ServicePrincipalNames "host/WebApp01", "host/WebApp01.windowsoneks.aws" -PrincipalsAllowedToRetrieveManagedPassword "WebApp01Hosts$"
```

Generate the gMSA spec file for Kubernetes cluster

```powershell
mkdir  C:\ProgramData\Docker\CredentialSpecs

Add-ADGroupMember -Identity 'WebApp01Hosts' -Members $env:computername$ -Credential $domain_admin_credential

Restart-Computer -Force

$ResourceName = "gmsawebapp01"

New-CredentialSpec -AccountName WebApp01
$dockerCredSpecPath = (Get-CredentialSpec | Where-Object {$_.Name -like "$dockerCredSpecName*"}).Path

$credSpecContents = Get-Content $dockerCredSpecPath | ConvertFrom-Json
# and clean it up
Remove-Item $dockerCredSpecPath

# generate the k8s resource
$resource = [ordered]@{
    "apiVersion" = "windows.k8s.io/v1alpha1";
    "kind" = 'GMSACredentialSpec';
    "metadata" = @{
        "name" = $ResourceName
    };
    "credspec" = $credSpecContents
}

ConvertTo-Yaml $resource
```

Save the output locally , instead the file gmsa-example.yaml , and apply it with kubectl

```bash
kubectl apply -f lib/gmsa-crd.yml
kubectl apply -f lib/gmsa-example.yaml
kubectl apply -f lib/gmsa-webapp1-role.yaml
kubectl apply -f lib/gmsa-webapp1-rolebinding.yaml
```

Create a Folder in the FSx filesystem. using the following commands: 
(Get the parameters from FSx Console)

Screenshot:
	
![](./Screenshots/Pasted%20image%2020210802181213.png)

```typescript
$FSX = "fsxDNSName.domainname" ## Amazon FSx DNS Name
$FSxPS = "fsxPSNAme.domainname" # Amazon FSx PowerShell endpoint
$FolderName = "ContainerStorage"
$ContainersFolderName = "folder1"

# Create the folder (the shared driver to the hosts)
New-Item -ItemType Directory -Name $FolderName -Path \\$FSX\D$\ 

# Create the folder to mount to the Pods 
New-Item -ItemType Directory -Name $ContainersFolderName -Path \\$FSX\D$\$FolderName\ 

Set NTFS Permissions

# The gMSA Account

$UserFQDN = “Windowsoneks\WebApp01$”

$ACL = Get-Acl \\$FSx\D$\$FolderName
$Ar = New-Object system.security.accesscontrol.filesystemaccessrule($UserFQDN,"FullControl","ObjectInherit","None", "Allow")
$ACL.SetAccessRule($Ar)
Set-Acl \\$FSX\D$\$FolderName $ACL

# Create the Share and set the share permissions
$Session = New-PSSession -ComputerName $FSxPS -ConfigurationName FsxRemoteAdmin
Import-PsSession $Session
New-FSxSmbShare -Name $FolderName -Path "D:\$FolderName" -Description "Shared folder with gMSA access" -Credential $domain_admin_credential -FolderEnumerationMode AccessBased
Grant-FSxSmbShareaccess -Name $FolderName -AccountName $UserFQDN -accessRight Full -Confirm:$false
Disconnect-PSSession -Session $Session
```
	

gMSA Webhook for automatic mount the CredFile to the Pod <Optional>
To install the gMSA Webhook Admission controller, you’ll use an existing script. As this script was created to be used on a Linux OS, you can use Windows Subsystem for Linux (WSL) or simple launch an EC2 Amazon Linux. Assuming you already have the Amazon EC2 Linux with AWS CLI and kubectl installed as part of the prerequisites. Run the following command to setup the kubectl to be used with your Amazon EKS cluster:

```
aws eks --region region-code update-kubeconfig --name cluster_name
curl -L https://raw.githubusercontent.com/kubernetes-sigs/windows-gmsa/master/admission-webhook/deploy/deploy-gmsa-webhook.sh --output deploy-gmsa-webhook.sh
chmod +x deploy-gmsa-webhook.sh
K8S_GMSA_DEPLOY_DOWNLOAD_REV='v0.1.0' 
./deploy-gmsa-webhook.sh --file ./gmsa-manifests --image wk88/k8s-gmsa-webhook:v1.15 --overwrite
```


**Step 6: Deploying Windows autoscaling group**

Uncomment the Windows_nodes object from the CDK code

```typescript
const windows_nodes = new WindowsEKSNodes(
 this,
 "Windows-Nodes-Stack",
 vpc_infrasracture,
 eks_infra
 );
```

And launch again the CDK code.

`cdk deploy --all`

At this point, you should have EKS with Windows Nodes running that are part of your AD domain and new instances should mount the Amazon FSx Volume automatically.

Note: Adding windows nodes takes around 10 minutes.

**Step 7: Scheduling pods**


Scheduling pods with the yaml file provided

```
kubectl apply -f lib/windows_server_iis.yaml
```

Monitor the progress with 

```
kubectl get svc,deploy,pods
```

Once ready, get the web URL:

```
export WINDOWS_IIS_SVC=$(kubectl get svc -o jsonpath='{.items[1].status.loadBalancer.ingress[].hostname}')

echo http://${WINDOWS_IIS_SVC}
```