# Create a startup script to handle NVMe refresh on start/stop instance
$bootfix = {
    if (!(Get-Volume -DriveLetter E)) {
        #Create pool and virtual disk for TempDB using mirroring with NVMe
        $NVMe = Get-PhysicalDisk | ? { $_.CanPool -eq $True -and $_.FriendlyName -eq "NVMe Amazon EC2 NVMe"}
        New-StoragePool –FriendlyName TempDBPool –StorageSubsystemFriendlyName "Windows Storage*" –PhysicalDisks $NVMe
        New-VirtualDisk -StoragePoolFriendlyName TempDBPool -FriendlyName TempDBDisk -ResiliencySettingName simple -ProvisioningType Fixed -UseMaximumSize
        Get-VirtualDisk –FriendlyName TempDBDisk | Get-Disk | Initialize-Disk –Passthru | New-Partition –DriveLetter E –UseMaximumSize | Format-Volume -FileSystem ReFS -AllocationUnitSize 65536 -NewFileSystemLabel TempDBfiles -Confirm:$false

        #grant Everyone full access to the new drive
        $item = gi -literalpath "E:\"
        $acl = $item.GetAccessControl()
        $permission="Everyone","FullControl","Allow"
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
        $acl.SetAccessRule($rule)
        $item.SetAccessControl($acl)
        }
}

New-Item -ItemType Directory -Path c:\Scripts    
$bootfix | set-content c:\Scripts\bootfix.ps1

# Create a scheduled task on startup to execute script if required (if E: is lost)
$action = New-ScheduledTaskAction -Execute 'Powershell.exe' -Argument 'c:\scripts\bootfix.ps1'
$trigger =  New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "Rebuild PageFile" -Description "Rebuild PageFile if required" -RunLevel Highest -User System

# Run it now as well
& $bootfix

## Domain settings
Install-WindowsFeature -Name "RSAT-AD-PowerShell" -IncludeAllSubFeature