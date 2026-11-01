param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class JunctionRaceFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle handle,uint code,byte[] input,int length,IntPtr output,int outputLength,out int returned,IntPtr overlapped);
 public static int Replace(string directory,string target){using(var handle=CreateFile(directory,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){
  if(handle.IsInvalid)return Marshal.GetLastWin32Error();
  byte[] sub=System.Text.Encoding.Unicode.GetBytes("\\??\\"+target),print=System.Text.Encoding.Unicode.GetBytes(target),data=new byte[16+sub.Length+print.Length+4];
  Array.Copy(BitConverter.GetBytes(0xA0000003u),0,data,0,4);Array.Copy(BitConverter.GetBytes((ushort)(data.Length-8)),0,data,4,2);
  Array.Copy(BitConverter.GetBytes((ushort)sub.Length),0,data,10,2);Array.Copy(BitConverter.GetBytes((ushort)(sub.Length+2)),0,data,12,2);Array.Copy(BitConverter.GetBytes((ushort)print.Length),0,data,14,2);
  Array.Copy(sub,0,data,16,sub.Length);Array.Copy(print,0,data,18+sub.Length,print.Length);int returned;
  return DeviceIoControl(handle,0x000900A4,data,data.Length,IntPtr.Zero,0,out returned,IntPtr.Zero)?0:Marshal.GetLastWin32Error();
 }}
}
'@
[JunctionRaceFixture]::Replace($Directory,$Target)
