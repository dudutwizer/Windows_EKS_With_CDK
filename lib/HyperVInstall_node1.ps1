$ADGroup = "HyperVhosts"
$FSX = "amznfsxcqwwyvtj.rdsfarm.aws" ## Amazon FSx DNS Name
$FSxPS = "amznfsxycv6z8zg.rdsfarm.aws" # Amazon FSx PowerShell endpoint
$FolderName = "RDSVMs"
$domainName = "rdsfarm.aws"

New-ADGroup -Name $ADGroup -SamAccountName $ADGroup -GroupScope DomainLocal
Add-ADGroupMember -Identity $ADGroup -Members $env:computername$

# Create the folder on the FSx
New-Item -ItemType Directory -Name $FolderName -Path \\$FSX\D$\ 

$ACL = Get-Acl \\$FSx\D$\$FolderName
$permission = "NT AUTHORITY\Authenticated Users","FullControl","Allow"
$Ar = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$ACL.SetAccessRule($Ar)
Set-Acl \\$FSX\D$\$FolderName $ACL

# Create the Share and set the share permissions
$Session = New-PSSession -ComputerName $FSxPS -ConfigurationName FsxRemoteAdmin
Import-PsSession $Session
New-FSxSmbShare -Name $FolderName -Path "D:\$FolderName" -Description "RDS VMs volume" -ContinuouslyAvailable $True -FolderEnumerationMode AccessBased -EncryptData $True 
$accessList= "$domainName\$ADGroup", "$domainName\AWS Delegated Administrators"
Grant-FSxSmbShareaccess -Name $FolderName -AccountName $accessList -accessRight Full -Confirm:$false
Disconnect-PSSession -Session $Session 


## Configuring the Hyper-V
New-VMSwitch -SwitchName "Hyper-VSwitch" -SwitchType Internal
New-NetIPAddress -IPAddress 10.1.0.1 -PrefixLength 16 -InterfaceIndex (Get-NetAdapter | ? {$_.Name -like 'vEthernet*'}).ifIndex
New-NetNat -Name MyNATnetwork -InternalIPInterfaceAddressPrefix 10.1.0.0/16
Install-WindowsFeature -Name 'DHCP' -IncludeManagementTools
Add-DhcpServerv4Scope -Name GuestIPRange -StartRange 10.1.0.1 -EndRange 10.1.254.254 -SubnetMask 255.255.0.0 -State Active
Set-DhcpServerv4OptionValue -ComputerName $env:computername -Router 10.1.0.1 -DnsServer 10.0.0.2
Set-VMHost -VirtualMachinePath "\\$FSX\$FolderName"
Set-VMHost -VirtualHardDiskPath "\\$FSX \$FolderName"

# --------------- #

# Not tested:

New-NetFirewallRule -DisplayName ‘Allow local VPC’ -Direction Inbound -LocalAddress 10.0.0.0/16 -LocalPort Any -Action Allow
Add-DhcpServerInDC -DnsName $env:computername.$domainName -IPAddress $domainName

## ON shutdown run:

