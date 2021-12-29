
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
//... all the other objects should be disabled for now
 ```

Launch the CDK code

`cdk deploy --all`

**Step 2: Customize the infrastructure:** <Optional>

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

**Step 4: Setting the permissions to kubectl cli**

Grant local permissions:
From the output of the CDK run the commands

![](./Screenshots/Pasted%20image%2020210802181109.png)

```typescript
aws eks update-kubeconfig --name <cluster-name> --region us-east-1 --role-arn <role-arn>
```

Now kubectl should work on your local machine, configured with the right EKS cluster.

Edit the `lib/aws-auth-cm-windows.yaml` file and apply it with `kubectl apply -f lib/aws-auth-cm-windows.yaml`

**Required** 
[Install eksctl](https://docs.aws.amazon.com/eks/latest/userguide/eksctl.html) CLI on your machine and enable Windows Support on the cluster:

  
```bash
eksctl utils install-vpc-controllers --cluster <cluster-name> --approve  
kubectl rollout restart deployment -n kube-system vpc-admission-webhook
```

At this stage, the cluster is ready to add Windows Nodes.
	
**Step 5: Configure the FSx and the gMSA accounts**

Login to the Worker Machine with domain account (get the password from Secrets Manager).

Get the password using the following command:
```
aws secretsmanager get-secret-value --secret-id <secret-arn> -q-query SecretString --output text
```

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
New-ADServiceAccount -Name "WebApp01" -DnsHostName "WebApp01.windowsoneks.aws" -ServicePrincipalNames "host/WebApp01", "host/WebApp01.windowsoneks.aws" -PrincipalsAllowedToRetrieveManagedPassword "WebApp01Hosts"

mkdir C:\ProgramData\Docker\CredentialSpecs

Add-ADGroupMember -Identity 'WebApp01Hosts' -Members $env:computername$ -Credential $domain_admin_credential
```

Restart the worker machine `Restart-Computer -Force` 

Generate the gMSA spec file for Kubernetes cluster

```powershell

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
kubectl apply -f lib/gMSA/gmsa-crd.yml
kubectl apply -f lib/gMSA/gmsa-example.yaml # Apply only after editing this file (!) 
kubectl apply -f lib/gMSA/gmsa-webapp1-role.yaml
kubectl apply -f lib/gMSA/gmsa-webapp1-rolebinding.yaml
```

## Create a Folder in the FSx filesystem. 

You can get the parameters from FSx Console or with aws CLI `aws fsx describe-file-systems --query 'FileSystems[*].[DNSName, WindowsConfiguration.RemoteAdministrationEndpoint]'`

FSx Console Screenshot:
	
![](./Screenshots/Pasted%20image%2020210802181213.png)

Create the folder using the following commands: 

```typescript
$FSX = "fsxDNSName.domainname" ## Amazon FSx DNS Name
$FSxPS = "fsxPSNAme.domainname" # Amazon FSx PowerShell endpoint
$FolderName = "ContainerStorage"
$ContainersFolderName = "folder1"

# Create the folder (the shared driver to the hosts)
New-Item -ItemType Directory -Name $FolderName -Path \\$FSX\D$\ 

# Create the folder to mount to the Pods 
New-Item -ItemType Directory -Name $ContainersFolderName -Path \\$FSX\D$\$FolderName\ 

# Set NTFS Permissions

# The gMSA Account

$ACL = Get-Acl \\$FSx\D$\$FolderName
$permission = "NT AUTHORITY\Authenticated Users","FullControl","Allow"
$Ar = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$ACL.SetAccessRule($Ar)
Set-Acl \\$FSX\D$\$FolderName $ACL

# Create the Share and set the share permissions
$Session = New-PSSession -ComputerName $FSxPS -ConfigurationName FsxRemoteAdmin
Import-PsSession $Session
New-FSxSmbShare -Name $FolderName -Path "D:\$FolderName" -Description "Shared folder with gMSA access" -Credential $domain_admin_credential -FolderEnumerationMode AccessBased
$accessList="NT AUTHORITY\Authenticated Users"
Grant-FSxSmbShareaccess -Name $FolderName -AccountName $accessList -accessRight Full -Confirm:$false
Disconnect-PSSession -Session $Session 
```
	

### gMSA Webhook for automatic mount the CredFile to the Pod

To install the gMSA Webhook Admission controller, you’ll use an existing script. As this script was created to be used on a Linux OS, you can use Windows Subsystem for Linux (WSL) or launch an EC2 Amazon Linux. You will need AWS CLI and kubectl installed as part of the prerequisites. 

To install WSL on Windows run `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux` and restart, then install Ubuntu manually (Windows Server OS doesn't support Microsoft Store) using the following guide [https://docs.microsoft.com/en-us/windows/wsl/install-manual#downloading-distributions](https://docs.microsoft.com/en-us/windows/wsl/install-manual#downloading-distributions)

Here is the code snippet to install WSL with Ubuntu on Windows EC2 

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
Invoke-WebRequest -Uri https://aka.ms/wslubuntu2004 -OutFile Ubuntu.appx -UseBasicParsing
Add-AppxPackage .\Ubuntu.appx
Restart-Computer -Force
```

On your WSL Instance install AWS CLI and kubectl:

```
curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
sudo mv /tmp/eksctl /usr/local/bin
curl -o kubectl https://amazon-eks.s3.us-west-2.amazonaws.com/1.21.2/2021-07-05/bin/linux/amd64/kubectl
chmod +x ./kubectl
mkdir -p $HOME/bin && cp ./kubectl $HOME/bin/kubectl && export PATH=$PATH:$HOME/bin
kubectl version --short --client
sudo ./aws/install
sudo apt-get update
sudo apt-get install awscli
aws --version
```

On your Linux OS, Run the following commands to setup the kubectl to be used with your Amazon EKS cluster.

```
aws eks update-kubeconfig --name <ClusterName> --region <Region> --role-arn <The IAM Role that created the cluster>
aws eks get-token --cluster-name <ClusterName> --region us-east-1 --role-arn <The IAM Role that created the cluster>
curl -L https://raw.githubusercontent.com/kubernetes-sigs/windows-gmsa/master/admission-webhook/deploy/deploy-gmsa-webhook.sh --output deploy-gmsa-webhook.sh
K8S_GMSA_DEPLOY_DOWNLOAD_REV='v0.1.0' ./deploy-gmsa-webhook.sh --file ./gmsa-manifests --image wk88/k8s-gmsa-webhook:v1.15 --overwrite # Workaround explained here https://github.com/kubernetes-sigs/windows-gmsa/issues/49
```

Now apply again the gMSA file from the previous step
```
kubectl apply -f lib/gMSA/gmsa-example.yaml # Apply only after editing this file (!) 
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
kubectl apply -f lib/hello-iis/windows_server_iis.yaml
```

# Tests

## Pod level

SMB Global Mapping accessible from the pod: 

```
kubectl exec -it windows-server-iis-56c7bcb674-gzsv5 powershell
```

![](/static/images/screenshots/2021-12-30-01-44-14.png?classes=border,shadow)

Domain services using gMSA file from the pod
```
nltest /sc_verify:windowsoneks.aws
```

![](/static/images/screenshots/2021-12-30-01-45-14.png?classes=border,shadow)

## Host level

Check if the machine joined the domain
```
systeminfo | findstr /B "Domain"
```

![](/static/images/screenshots/2021-12-30-01-48-36.png?classes=border,shadow)

check if the SMB Global Mapping mapped automatically 

```
Get-SmbGlobalMapping
```

![](/static/images/screenshots/2021-12-30-01-49-50.png?classes=border,shadow)

## Cluster level


Monitor the progress with 

```
kubectl get svc,deploy,pods
```

![](/static/images/screenshots/2021-12-30-01-50-55.png?classes=border,shadow)

Once ready, get the web URL:

```
export WINDOWS_IIS_SVC=$(kubectl get svc -o jsonpath='{.items[1].status.loadBalancer.ingress[].hostname}')

echo http://${WINDOWS_IIS_SVC}
```

Open the website

![](/static/images/screenshots/2021-12-30-01-52-04.png?classes=border,shadow)