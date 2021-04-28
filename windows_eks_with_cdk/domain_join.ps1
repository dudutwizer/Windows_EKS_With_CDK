<powershell>
## Script from https://aws.amazon.com/blogs/compute/managing-domain-membership-of-dynamic-fleet-of-ec2-instances/
# Script parameters
[string]$SecretAD = "ManagedAD-Admin-Password"
​
class Logger {
	#----------------------------------------------
	[string] hidden  $cwlGroup
	[string] hidden  $cwlStream
	[string] hidden  $sequenceToken
	#----------------------------------------------
	# Log Initialization
	#----------------------------------------------
	Logger([string] $Action) {
		$this.cwlGroup = "/ps/boot/configuration/"
		$this.cwlStream	= "{0}/{1}/{2}" -f $env:COMPUTERNAME, $Action,
		(Get-Date -UFormat "%Y-%m-%d_%H.%M.%S")
		$this.sequenceToken = ""
		#------------------------------------------
		if ( !(Get-CWLLogGroup -LogGroupNamePrefix $this.cwlGroup) ) {
			New-CWLLogGroup -LogGroupName $this.cwlGroup
			Write-CWLRetentionPolicy -LogGroupName $this.cwlGroup -RetentionInDays 3
		}
		if ( !(Get-CWLLogStream -LogGroupName $this.cwlGroup -LogStreamNamePrefix $this.cwlStream) ) {
			New-CWLLogStream -LogGroupName $this.cwlGroup -LogStreamName $this.cwlStream
		}
	}
	#----------------------------------------
	[void] WriteLine([string] $msg) {
		$logEntry = New-Object -TypeName "Amazon.CloudWatchLogs.Model.InputLogEvent"
		#-----------------------------------------------------------
		$logEntry.Message = $msg
		$logEntry.Timestamp = (Get-Date).ToUniversalTime()
		if ("" -eq $this.sequenceToken) {
			# First write into empty log...
			$this.sequenceToken = Write-CWLLogEvent -LogGroupName $this.cwlGroup `
				-LogStreamName $this.cwlStream `
				-LogEvent $logEntry
		}
		else {
			# Subsequent write into the log...
			$this.sequenceToken = Write-CWLLogEvent -LogGroupName $this.cwlGroup `
				-LogStreamName $this.cwlStream `
				-SequenceToken $this.sequenceToken `
				-LogEvent $logEntry
		}
	}
}
[Logger]$log = [Logger]::new("UserData")
$log.WriteLine("------------------------------")
$log.WriteLine("Log Started - V4.0")
$RunUser = $env:username
$log.WriteLine("PowerShell session user: $RunUser")
​
class SDManager {
	#-------------------------------------------------------------------
	[Logger] hidden $SDLog
	[string] hidden $GPScrShd_0_0 = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Shutdown\0\0"
	[string] hidden $GPMScrShd_0_0 = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine\Scripts\Shutdown\0\0"
	#-------------------------------------------------------------------
	SDManager([Logger]$Log, [string]$RegFilePath, [string]$SecretName) {
		$this.SDLog = $Log
		#----------------------------------------------------------------
		[string] $SecretLine = '[string]$SecretAD    = "' + $SecretName + '"'
		#--------------- Local Variables -------------
		[string] $GPRootPath = "C:\Windows\System32\GroupPolicy"
		[string] $GPMcnPath = "C:\Windows\System32\GroupPolicy\Machine"
		[string] $GPScrPath = "C:\Windows\System32\GroupPolicy\Machine\Scripts"
		[string] $GPSShdPath = "C:\Windows\System32\GroupPolicy\Machine\Scripts\Shutdown"
		[string] $ScriptFile = [System.IO.Path]::Combine($GPSShdPath, "Shutdown-UnJoin.ps1")
		#region Shutdown script (scheduled through Local Policy)
		$ScriptBody =
		@(
			'param([string]$cntrl = "NotSet")',
			$SecretLine,
			'[string]$MachineName = $env:COMPUTERNAME',
			'class Logger {    ',
			'    #----------------------------------------------    ',
			'    [string] hidden  $cwlGroup    ',
			'    [string] hidden  $cwlStream    ',
			'    [string] hidden  $sequenceToken    ',
			'    #----------------------------------------------    ',
			'    # Log Initialization    ',
			'    #----------------------------------------------    ',
			'    Logger([string] $Action) {    ',
			'        $this.cwlGroup = "/ps/boot/configuration/"    ',
			'        $this.cwlStream = "{0}/{1}/{2}" -f $env:COMPUTERNAME, $Action,    ',
			'                                           (Get-Date -UFormat "%Y-%m-%d_%H.%M.%S")    ',
			'        $this.sequenceToken = ""    ',
			'        #------------------------------------------    ',
			'        if ( !(Get-CWLLogGroup -LogGroupNamePrefix $this.cwlGroup) ) {    ',
			'            New-CWLLogGroup -LogGroupName $this.cwlGroup    ',
			'            Write-CWLRetentionPolicy -LogGroupName $this.cwlGroup -RetentionInDays 3    ',
			'        }    ',
			'        if ( !(Get-CWLLogStream -LogGroupName $this.cwlGroup -LogStreamNamePrefix $this.cwlStream) ) {    ',
			'            New-CWLLogStream -LogGroupName $this.cwlGroup -LogStreamName $this.cwlStream    ',
			'        }    ',
			'    }    ',
			'    #----------------------------------------    ',
			'    [void] WriteLine([string] $msg) {    ',
			'        $logEntry = New-Object -TypeName "Amazon.CloudWatchLogs.Model.InputLogEvent"    ',
			'        #-----------------------------------------------------------    ',
			'        $logEntry.Message = $msg    ',
			'        $logEntry.Timestamp = (Get-Date).ToUniversalTime()    ',
			'        if ("" -eq $this.sequenceToken) {    ',
			'            # First write into empty log...    ',
			'            $this.sequenceToken = Write-CWLLogEvent -LogGroupName $this.cwlGroup `',
			'                -LogStreamName $this.cwlStream `',
			'                -LogEvent $logEntry    ',
			'        }    ',
			'        else {    ',
			'            # Subsequent write into the log...    ',
			'            $this.sequenceToken = Write-CWLLogEvent -LogGroupName $this.cwlGroup `',
			'                -LogStreamName $this.cwlStream `',
			'                -SequenceToken $this.sequenceToken `',
			'                -LogEvent $logEntry    ',
			'        }    ',
			'    }    ',
			'}    ',
			'[Logger]$log = [Logger]::new("UnJoin")',
			'$log.WriteLine("-----------------------------------------")',
			'$log.WriteLine("Log Started")',
			'if ($cntrl -ne "run") ',
			'    { ',
			'    $log.WriteLine("Script param <" + $cntrl + "> not set to <run> - script terminated") ',
			'    return',
			'    }',
			'$compSys = Get-WmiObject -Class Win32_ComputerSystem',
			'if ( -Not ($compSys.PartOfDomain))',
			'    {',
			'    $log.WriteLine("Not member of a domain - terminating script")',
			'    return',
			'    }',
			'$RSAT = (Get-WindowsFeature RSAT-AD-PowerShell)',
			'if ( $RSAT -eq $null -or (-Not $RSAT.Installed) )',
			'    {',
			'    $log.WriteLine("<RSAT-AD-PowerShell> feature not found - terminating script")',
			'    return',
			'    }',
			'$log.WriteLine("Removing machine <" +$MachineName + "> from Domain <" + $compSys.Domain + ">")',
			'$log.WriteLine("Reading Secret <" + $SecretAD + ">")',
			'Import-Module AWSPowerShell',
			'try { $SecretObj = (Get-SECSecretValue -SecretId $SecretAD) }',
			'catch ',
			'    { ',
			'    $log.WriteLine("Could not load secret <" + $SecretAD + "> - terminating execution")',
			'    return ',
			'    }',
			'[PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)',
			'$password   = $Secret.Password | ConvertTo-SecureString -asPlainText -Force',
			'$username   = $Secret.UserID + "@" + $Secret.Domain',
			'$credential = New-Object System.Management.Automation.PSCredential($username,$password)',
			'import-module ActiveDirectory',
			'$DCHostName = (Get-ADDomainController -Discover).HostName',
			'$log.WriteLine("Using Account <" + $username + ">")',
			'$log.WriteLine("Using Domain Controller <" + $DCHostName + ">")',
			'Remove-Computer -WorkgroupName "WORKGROUP" -UnjoinDomainCredential $credential -Force -Confirm:$false ',
			'Remove-ADComputer -Identity $MachineName -Credential $credential -Server "$DCHostName" -Confirm:$false ',
			'$log.WriteLine("Machine <" +$MachineName + "> removed from Domain <" + $compSys.Domain + ">")'
		)
​
		$this.SDLog.WriteLine("Constracting artifacts required for domain UnJoin")
		#----------------------------------------------------------------
		try {
			if (!(Test-Path -Path $GPRootPath -pathType container))
			{ New-Item -ItemType directory -Path $GPRootPath }
			if (!(Test-Path -Path $GPMcnPath -pathType container))
			{ New-Item -ItemType directory -Path $GPMcnPath }
			if (!(Test-Path -Path $GPScrPath -pathType container))
			{ New-Item -ItemType directory -Path $GPScrPath }
			if (!(Test-Path -Path $GPSShdPath -pathType container))
			{ New-Item -ItemType directory -Path $GPSShdPath }
		}
		catch {
			$this.SDLog.WriteLine("Failure creating UnJoin script directory!" )
			$this.SDLog.WriteLine($_)
		}
		#----------------------------------------
		try {
			Set-Content $ScriptFile -Value $ScriptBody
		}
		catch {
			$this.SDLog.WriteLine("Failure saving UnJoin script!" )
			$this.SDLog.WriteLine($_)
		}
		#----------------------------------------
		$RegistryScript =
		@(
			'Windows Registry Editor Version 5.00',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts]',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Shutdown]',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Shutdown\0]',
			'"GPO-ID"="LocalGPO"',
			'"SOM-ID"="Local"',
			'"FileSysPath"="C:\\Windows\\System32\\GroupPolicy\\Machine"',
			'"DisplayName"="Local Group Policy"',
			'"GPOName"="Local Group Policy"',
			'"PSScriptOrder"=dword:00000001',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Shutdown\0\0]',
			'"Script"="Shutdown-UnJoin.ps1"',
			'"Parameters"=""',
			'"IsPowershell"=dword:00000001',
			'"ExecTime"=hex(b):00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Startup]',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine\Scripts]',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine\Scripts\Shutdown]',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine\Scripts\Shutdown\0]',
			'"GPO-ID"="LocalGPO"',
			'"SOM-ID"="Local"',
			'"FileSysPath"="C:\\Windows\\System32\\GroupPolicy\\Machine"',
			'"DisplayName"="Local Group Policy"',
			'"GPOName"="Local Group Policy"',
			'"PSScriptOrder"=dword:00000001',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine\Scripts\Shutdown\0\0]',
			'"Script"="Shutdown-UnJoin.ps1"',
			'"Parameters"=""',
			'"ExecTime"=hex(b):00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00',
			'[HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine\Scripts\Startup]'
		)
		try {
			[string] $RegistryFile = [System.IO.Path]::Combine($RegFilePath, "OnShutdown.reg")
			Set-Content $RegistryFile -Value $RegistryScript
			&regedit.exe /S "$RegistryFile"
		}
		catch {
			$this.SDLog.WriteLine("Failure creating policy entry in Registry!" )
			$this.SDLog.WriteLine($_)
		}
	}
	#----------------------------------------
	[void] DisableUnJoin() {
		try {
			Set-ItemProperty -Path $this.GPScrShd_0_0  -Name "Parameters" -Value "ignore"
			Set-ItemProperty -Path $this.GPMScrShd_0_0 -Name "Parameters" -Value "ignore"
			&gpupdate /Target:computer /Wait:0
		}
		catch {
			$this.SDLog.WriteLine("Failure in <DisableUnjoin> function!" )
			$this.SDLog.WriteLine($_)
		}
	}
	#----------------------------------------
	[void] EnableUnJoin() {
		try {
			Set-ItemProperty -Path $this.GPScrShd_0_0  -Name "Parameters" -Value "run"
			Set-ItemProperty -Path $this.GPMScrShd_0_0 -Name "Parameters" -Value "run"
			&gpupdate /Target:computer /Wait:0
		}
		catch {
			$this.SDLog.WriteLine("Failure in <EnableUnjoin> function!" )
			$this.SDLog.WriteLine($_)
		}
	}
}
​
[SDManager]$sdm = [SDManager]::new($Log, "C:\ProgramData\Amazon\EC2-Windows\Launch\Scripts", $SecretAD)
​
$log.WriteLine("Loading Secret <" + $SecretAD + ">")
Import-Module AWSPowerShell
try { $SecretObj = (Get-SECSecretValue -SecretId $SecretAD) }
catch {
	$log.WriteLine("Could not load secret <" + $SecretAD + "> - terminating execution")
	return
}
[PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)
$log.WriteLine("Domain (from Secret): <" + $Secret.Domain + ">")
# Verify domain membership
$compSys = Get-WmiObject -Class Win32_ComputerSystem
#------------------------------------------------------------------------------
if ( ($compSys.PartOfDomain) -and ($compSys.Domain -eq $Secret.Domain)) {
	$log.WriteLine("Already member of: <" + $compSys.Domain + "> - Verifying RSAT Status")
​
	$RSAT = (Get-WindowsFeature RSAT-AD-PowerShell)
	if ($null -eq $RSAT) {
		$log.WriteLine("<RSAT-AD-PowerShell> feature not found - terminating script")
		return
	}
​
	$log.WriteLine("Enable OnShutdown task to un-join Domain")
	$sdm.EnableUnJoin()
​
	if ( (-Not $RSAT.Installed) -and ($RSAT.InstallState -eq "Available") ) {
		$log.WriteLine("Installing <RSAT-AD-PowerShell> feature")
		Install-WindowsFeature RSAT-AD-PowerShell
	}
​
	$log.WriteLine("Terminating script - ")
	return
}
# Performing Domain Join
$log.WriteLine("Domain Join required")
​
$log.WriteLine("Disable OnShutdown task to avoid reboot loop")
$sdm.DisableUnJoin()
$password = $Secret.Password | ConvertTo-SecureString -asPlainText -Force
$username = $Secret.UserID + "@" + $Secret.Domain
$credential = New-Object System.Management.Automation.PSCredential($username, $password)
​
$log.WriteLine("Attempting to join domain <" + $Secret.Domain + ">")
Add-Computer -DomainName $Secret.Domain -Credential $credential -Restart -Force
​
$log.WriteLine("Requesting restart...")
#------------------------------------------------------------------------------
</powershell>
<persist>true</persist>