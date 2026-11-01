param([string]$Container,[string]$Runtime)
$ErrorActionPreference='Stop'
# The fixture deliberately grants a restricted caller its control directory;
# the guarded child must remain inaccessible under actual kernel access checks.
$acl=[System.IO.Directory]::GetAccessControl($Container)
$everyone=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($everyone,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($Container,$acl)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class RuntimeGuardRestrictedToken {
 [StructLayout(LayoutKind.Sequential)] struct Sid {public IntPtr Value;public uint Attributes;}
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint rights,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint disabled,IntPtr disabledSids,uint privileges,IntPtr disabledPrivileges,uint restricted,Sid[] restrictedSids,out IntPtr result);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool ImpersonateLoggedOnUser(IntPtr token);
 [DllImport("advapi32.dll")] static extern bool RevertToSelf();
 public static void Run(string container,string runtime){
  IntPtr token=IntPtr.Zero,restricted=IntPtr.Zero,sid=IntPtr.Zero;
  try{
   if(!OpenProcessToken(GetCurrentProcess(),0x000F01FF,out token))throw new System.ComponentModel.Win32Exception();
   var everyone=new SecurityIdentifier("S-1-1-0");byte[] bytes=new byte[everyone.BinaryLength];everyone.GetBinaryForm(bytes,0);sid=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,sid,bytes.Length);
   if(!CreateRestrictedToken(token,1,0,IntPtr.Zero,0,IntPtr.Zero,1,new Sid[]{new Sid{Value=sid}},out restricted)||!ImpersonateLoggedOnUser(restricted))throw new System.ComponentModel.Win32Exception();
   File.WriteAllText(Path.Combine(container,"control"),"allowed");
   int denied=0;Action[] attempts={()=>File.WriteAllText(Path.Combine(runtime,"forbidden"),"changed"),()=>Directory.CreateDirectory(Path.Combine(runtime,"forbidden-directory")),()=>File.Delete(Path.Combine(runtime,"owner.lock"))};
   foreach(var attempt in attempts){try{attempt();}catch(UnauthorizedAccessException){denied++;}catch(IOException){denied++;}}
   if(denied!=attempts.Length)throw new Exception("Restricted token changed guarded runtime");
   Console.WriteLine("control allowed; guarded mutations denied");
  }finally{RevertToSelf();if(restricted!=IntPtr.Zero)CloseHandle(restricted);if(token!=IntPtr.Zero)CloseHandle(token);if(sid!=IntPtr.Zero)Marshal.FreeHGlobal(sid);}
 }
}
'@
[RuntimeGuardRestrictedToken]::Run($Container,$Runtime)
