param([string]$Runtime,[string]$Outside,[string]$Control)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RuntimeGuardJunction {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle handle,uint code,byte[] input,uint inputBytes,IntPtr output,uint outputBytes,out uint returned,IntPtr overlapped);
 static int Set(string directory,string outside){
  byte[] substitute=Encoding.Unicode.GetBytes("\\??\\"+outside),print=Encoding.Unicode.GetBytes(outside),data=new byte[16+substitute.Length+2+print.Length+2];
  Array.Copy(BitConverter.GetBytes(0xA0000003u),0,data,0,4);Array.Copy(BitConverter.GetBytes((ushort)(data.Length-8)),0,data,4,2);Array.Copy(BitConverter.GetBytes((ushort)substitute.Length),0,data,10,2);Array.Copy(BitConverter.GetBytes((ushort)(substitute.Length+2)),0,data,12,2);Array.Copy(BitConverter.GetBytes((ushort)print.Length),0,data,14,2);Array.Copy(substitute,0,data,16,substitute.Length);Array.Copy(print,0,data,18+substitute.Length,print.Length);
  using(var handle=CreateFile(directory,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){
   if(handle.IsInvalid)return Marshal.GetLastWin32Error();uint returned;if(!DeviceIoControl(handle,0x900A4,data,(uint)data.Length,IntPtr.Zero,0,out returned,IntPtr.Zero))return Marshal.GetLastWin32Error();
   byte[] clear=new byte[8];Array.Copy(BitConverter.GetBytes(0xA0000003u),clear,4);if(!DeviceIoControl(handle,0x900AC,clear,8,IntPtr.Zero,0,out returned,IntPtr.Zero))throw new System.ComponentModel.Win32Exception();return 0;
  }
 }
 public static void Run(string runtime,string outside,string control){Console.WriteLine("control="+Set(control,outside));Console.WriteLine("guarded="+Set(runtime,outside));}
}
'@
[RuntimeGuardJunction]::Run($Runtime,$Outside,$Control)
