// The runtime subtree is admitted before subprocesses receive pathname access.
// An inherited file pin and a non-breakaway job retain protection through exit.
using System;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Observanda {
 public static partial class MutationFiles {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public uint Size;public string Reserved,Desktop,Title;public uint X,Y,XSize,YSize,XCount,YCount,Fill,Flags;public ushort Show,ReservedSize;public IntPtr ReservedBytes,Input,Output,Error;}
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr Process,Thread;public uint ProcessId,ThreadId;}
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {public long ProcessTime,JobTime;public uint Flags;public UIntPtr Minimum,Maximum;public uint Active;public UIntPtr Affinity;public uint Priority,Scheduling;}
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {public BasicLimits Basic;public IoCounters Io;public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;}
  [StructLayout(LayoutKind.Sequential)] struct JobAccounting {public long UserTime,KernelTime,PeriodUserTime,PeriodKernelTime;public uint Faults,Total,Active,Terminated;}
  [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle file,uint kind,uint parts,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll",SetLastError=true)] static extern uint SetSecurityInfo(SafeFileHandle file,uint kind,uint parts,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
  [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,out bool present,out IntPtr acl,out bool defaulted);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits value,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out JobAccounting value,uint size,IntPtr length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveType(string root);
  static readonly object guardOutput=new object(),guardState=new object();
  class GuardFailure:Failure {string reason;public GuardFailure(string value):base("DATABASE_GUARD_STORAGE"){reason=value;}public override string Message{get{return reason;}}}
  static readonly string guardUser=WindowsIdentity.GetCurrent().User.Value;static string guardMappedUser;
  static SafeFileHandle guardRoot,guardPin,guardNull;static FileStream guardPinStream;
  static IntPtr guardJob=IntPtr.Zero,guardChild=IntPtr.Zero;static Thread guardThread;static string guardPath;static bool guardClosing;
  static void GuardSend(object value){lock(guardOutput){Send(value);}}
  static bool TrustedSid(SecurityIdentifier sid){return sid!=null&&(sid.Value==guardUser||sid.Value==guardMappedUser||sid.Value=="S-1-5-18"||sid.Value=="S-1-5-32-544");}
  static string GuardPrincipal(SecurityIdentifier sid){if(sid==null)return "none";string value=sid.Value;if(value==guardUser)return "current-user";if(value=="S-1-5-18")return "system";if(value=="S-1-5-32-544")return "administrators";if(value=="S-1-1-0")return "everyone";if(value=="S-1-5-11")return "authenticated-users";if(value=="S-1-5-32-545")return "users";if(value=="S-1-3-0")return "creator-owner";if(value.StartsWith("S-1-22-1-"))return "unix-user";if(value.StartsWith("S-1-22-2-"))return "unix-group";return "other-principal";}
  static string GuardFingerprint(SecurityIdentifier sid){using(var hash=SHA256.Create())return Digest(hash.ComputeHash(Encoding.UTF8.GetBytes(sid==null?"none":sid.Value)));}
  static byte[] GuardAcl(SafeFileHandle file){
   IntPtr owner,group,dacl,sacl,descriptor;uint code=GetSecurityInfo(file,1,5,out owner,out group,out dacl,out sacl,out descriptor);if(code!=0)throw new GuardFailure("security-descriptor-unavailable");
   try{byte[] bytes=new byte[GetSecurityDescriptorLength(descriptor)];Marshal.Copy(descriptor,bytes,0,bytes.Length);var sd=new RawSecurityDescriptor(bytes,0);
    if(!TrustedSid(sd.Owner))throw new GuardFailure("untrusted-owner");if(sd.DiscretionaryAcl==null)throw new GuardFailure("missing-discretionary-acl");
    foreach(GenericAce ace in sd.DiscretionaryAcl){if((ace.AceFlags&AceFlags.InheritOnly)!=0)continue;var common=ace as CommonAce;if(common==null||common.IsCallback)throw new GuardFailure("unsupported-access-rule");if(common.AceQualifier==AceQualifier.AccessAllowed&&!TrustedSid(common.SecurityIdentifier)&&(unchecked((uint)common.AccessMask)&0x500D0156u)!=0)throw new GuardFailure("foreign-write-access");}
    return bytes;
   }finally{LocalFree(descriptor);}
  }
  static byte[] GuardPrivateDescriptor(){var sd=new RawSecurityDescriptor((guardMappedUser==null?"O:"+guardUser+"G:"+guardUser:"")+"D:P(A;OICI;FA;;;"+(guardMappedUser??guardUser)+")(A;OICI;FA;;;SY)");byte[] bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);return bytes;}
  static SafeFileHandle GuardOpen(SafeFileHandle parent,string name,bool folder,uint disposition,uint share,byte[] security,uint access=0xC0160080){
   Name(name);Information(parent,true);IntPtr buffer=Marshal.StringToHGlobalUni(name),unicode=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode))),sd=IntPtr.Zero;
   try{if(security!=null){sd=Marshal.AllocHGlobal(security.Length);Marshal.Copy(security,0,sd,security.Length);}Marshal.StructureToPtr(new Unicode{Length=(ushort)(name.Length*2),MaximumLength=(ushort)(name.Length*2+2),Buffer=buffer},unicode,false);
    var attrs=new Attributes{Length=(uint)Marshal.SizeOf(typeof(Attributes)),RootDirectory=parent.DangerousGetHandle(),ObjectName=unicode,Flags=0x40,SecurityDescriptor=sd};IoStatus status;SafeFileHandle result;
    int code=NtCreateFile(out result,access,ref attrs,out status,IntPtr.Zero,0x80,share,disposition,0x200000|0x20|(folder?1u:0x40u),IntPtr.Zero,0);
    if(code<0){if(result!=null)result.Dispose();Native(code);}try{Information(result,folder);return result;}catch{result.Dispose();throw;}
   }finally{if(sd!=IntPtr.Zero)Marshal.FreeHGlobal(sd);Marshal.FreeHGlobal(unicode);Marshal.FreeHGlobal(buffer);}
  }
  static void GuardSetPrivate(SafeFileHandle file,byte[] security){IntPtr sd=Marshal.AllocHGlobal(security.Length);try{Marshal.Copy(security,0,sd,security.Length);bool present,defaulted;IntPtr dacl;if(!GetSecurityDescriptorDacl(sd,out present,out dacl,out defaulted)||!present)throw new Failure("DATABASE_GUARD_STORAGE");uint code=SetSecurityInfo(file,1,0x80000004,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero);if(code!=0)throw new Failure("DATABASE_GUARD_STORAGE");}finally{Marshal.FreeHGlobal(sd);}}
  static bool GuardEmpty(SafeFileHandle folder){bool restart=true;for(;;){var page=json.Deserialize<Dictionary<string,object>>(json.Serialize(List(folder,restart)));restart=false;if(((ArrayList)page["entries"]).Count!=0)return false;if((bool)page["done"])return true;}}
  static SafeFileHandle GuardReplaceEmpty(SafeFileHandle parent,string name,SafeFileHandle original,byte[] security){
   // Changing an ACL cannot revoke a previously opened attacker handle. A
   // fresh object is required; never transfer that old authority into runtime.
   if(!GuardEmpty(original))throw new GuardFailure("nonprivate-runtime-requires-migration");
   string freshName=".runtime-private-"+Guid.NewGuid().ToString("N"),retiredName=".runtime-unclaimed-"+Guid.NewGuid().ToString("N");SafeFileHandle fresh=null;bool retired=false,published=false;
   try{fresh=GuardOpen(parent,freshName,true,2,7,security,0xC0170080);GuardAcl(fresh);Rename(original,parent,retiredName,10);retired=true;Rename(fresh,parent,name,10);published=true;
    // Directory disposition performs the final empty check in the kernel. A
    // raced-in member is retained under the retired name, never recursively deleted.
    try{Delete(original);}catch(Win32Exception){}original.Dispose();return fresh;
   }catch{if(retired&&!published)try{Rename(original,parent,name,10);}catch{}if(fresh!=null){try{Delete(fresh);}catch{}fresh.Dispose();}throw;}
  }
  static string GuardMappedCreator(SafeFileHandle parent){
   // The server supplies the owner of our successful exclusive creation. This
   // attests its authenticated identity mapping; a preexisting owner cannot.
   var descriptor=new RawSecurityDescriptor("D:P(A;OICI;FA;;;CO)(A;OICI;FA;;;SY)");byte[] bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);
   using(var created=GuardOpen(parent,".runtime-creator-"+Guid.NewGuid().ToString("N"),true,2,7,bytes,0xC0170080)){
    try{IntPtr owner,group,dacl,sacl,security;uint code=GetSecurityInfo(created,1,1,out owner,out group,out dacl,out sacl,out security);if(code!=0)throw new GuardFailure("security-descriptor-unavailable");try{return new SecurityIdentifier(owner).Value;}finally{LocalFree(security);}}
    finally{Delete(created);}
   }
  }
  static void GuardInspectTree(SafeFileHandle folder){
   bool restart=true;for(;;){var page=json.Deserialize<Dictionary<string,object>>(json.Serialize(List(folder,restart)));restart=false;
    foreach(Dictionary<string,object> entry in (ArrayList)page["entries"]){string name=(string)entry["name"];bool directory=(bool)entry["directory"];if(folder==guardRoot&&name=="owner.lock")continue;
     using(var child=Open(folder,name,directory,0x80020000)){Information(child,directory);GuardAcl(child);if(directory)GuardInspectTree(child);}
    }if((bool)page["done"])break;
   }
  }
  static string GuardStamp(byte[] acl){using(var hash=SHA256.Create())return "Observanda/runtime-admission/v1/"+Identity(Information(guardRoot,true))+"/"+Digest(hash.ComputeHash(acl));}
  static object GuardInspectStorage(Dictionary<string,object> command){
   string directory=Path.GetFullPath(Text(command,"directory"));Root(directory);var handle=directories[next];string identity=Identity(Information(handle,true));
   return GuardDescribeStorage(handle);
  }
  static object GuardProbeCreate(Dictionary<string,object> command){
   string directory=Path.GetFullPath(Text(command,"directory"));Root(Path.GetDirectoryName(directory));var parent=directories[next];
   var descriptor=new RawSecurityDescriptor("D:P(A;OICI;FA;;;CO)(A;OICI;FA;;;SY)");byte[] bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);
   if(!Flag(command,"mapped")){using(var created=GuardOpen(parent,Path.GetFileName(directory),true,2,7,bytes,0xC0170080))return GuardDescribeStorage(created);}
   using(var creator=GuardOpen(parent,".runtime-creator-"+Guid.NewGuid().ToString("N"),true,2,7,bytes,0xC0170080)){
    try{IntPtr owner,group,dacl,sacl,security;uint code=GetSecurityInfo(creator,1,1,out owner,out group,out dacl,out sacl,out security);if(code!=0)throw new GuardFailure("security-descriptor-unavailable");string sid;try{sid=new SecurityIdentifier(owner).Value;}finally{LocalFree(security);}
     descriptor=new RawSecurityDescriptor("D:P(A;OICI;FA;;;"+sid+")(A;OICI;FA;;;SY)");bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);
     using(var created=GuardOpen(parent,Path.GetFileName(directory),true,2,7,bytes,0xC0170080))return new {creator=GuardDescribeStorage(creator),created=GuardDescribeStorage(created)};
    }finally{Delete(creator);}
   }
  }
  static object GuardDescribeStorage(SafeFileHandle handle){
   string identity=Identity(Information(handle,true));
   IntPtr owner,group,dacl,sacl,descriptor;uint code=GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor);if(code!=0)throw new GuardFailure("security-descriptor-unavailable");
   try{byte[] bytes=new byte[GetSecurityDescriptorLength(descriptor)];Marshal.Copy(descriptor,bytes,0,bytes.Length);var sd=new RawSecurityDescriptor(bytes,0);var rules=new List<object>();
    if(sd.DiscretionaryAcl!=null)foreach(GenericAce ace in sd.DiscretionaryAcl){var common=ace as CommonAce;if(common!=null)rules.Add(new {principal=GuardPrincipal(common.SecurityIdentifier),principalFingerprint=GuardFingerprint(common.SecurityIdentifier),ownerPrincipal=common.SecurityIdentifier==sd.Owner,mask=unchecked((uint)common.AccessMask),allow=common.AceQualifier==AceQualifier.AccessAllowed,inheritOnly=(ace.AceFlags&AceFlags.InheritOnly)!=0});}
    string fingerprint;using(var hash=SHA256.Create())fingerprint=Digest(hash.ComputeHash(Encoding.UTF8.GetBytes(sd.Owner==null?"none":sd.Owner.Value)));string reason=null;try{GuardAcl(handle);}catch(GuardFailure error){reason=error.Message;}
    return new {identity=identity,rootPermissions=reason==null?"admissible":"requires-private-migration",reason=reason,ownerKind=GuardPrincipal(sd.Owner),ownerFingerprint=fingerprint,rules=rules,subtreeVerified=false,mutationProtectionQualified=false};
   }finally{LocalFree(descriptor);}
  }
  static bool GuardStamped(string expected){try{if(guardPinStream.Length<1||guardPinStream.Length>8192)return false;byte[] bytes=new byte[(int)guardPinStream.Length];guardPinStream.Position=0;int offset=0;while(offset<bytes.Length){int read=guardPinStream.Read(bytes,offset,bytes.Length-offset);if(read==0)return false;offset+=read;}byte[] clear=ProtectedData.Unprotect(bytes,null,DataProtectionScope.CurrentUser);try{return Encoding.UTF8.GetString(clear)==expected;}finally{Array.Clear(clear,0,clear.Length);}}catch(CryptographicException){return false;}}
  static object GuardAdmit(Dictionary<string,object> command){
   if(guardRoot!=null)throw new Failure("INVALID");guardPath=Path.GetFullPath(Text(command,"directory"));string parentPath=Path.GetDirectoryName(guardPath);if(String.IsNullOrEmpty(parentPath))throw new Failure("UNSAFE");
   Root(parentPath);SafeFileHandle parent=directories[next];string expected;object value;if(command.TryGetValue("parentIdentity",out value)&&value is string&&Identity(Information(parent,true))!=(string)value)throw new Failure("STORAGE_COPY");
   string volumeRoot=Path.GetPathRoot(guardPath);if(!volumeRoot.EndsWith("\\"))volumeRoot+="\\";uint driveType=GetDriveType(volumeRoot);if(driveType==0||driveType==1)throw new GuardFailure("storage-volume-type-unavailable");if(driveType==4)guardMappedUser=GuardMappedCreator(parent);
   byte[] security=GuardPrivateDescriptor();bool created=false;
   try{guardRoot=GuardOpen(parent,Path.GetFileName(guardPath),true,1,7,null,0xC0170080);}catch(Win32Exception error){if(!Flag(command,"create")||(error.NativeErrorCode!=2&&error.NativeErrorCode!=3))throw;guardRoot=GuardOpen(parent,Path.GetFileName(guardPath),true,2,7,security,0xC0170080);created=true;}
   if(command.TryGetValue("expectedIdentity",out value)&&value is string&&Identity(Information(guardRoot,true))!=(string)value)throw new Failure("STORAGE_COPY");
   try{GuardAcl(guardRoot);}catch(GuardFailure){if(!Flag(command,"create"))throw;guardRoot=GuardReplaceEmpty(parent,Path.GetFileName(guardPath),guardRoot,security);created=true;}
   // Network roots must originate from this verified private creation. A
   // same-owner legacy tree needs an explicit preserving migration first.
   if(guardMappedUser!=null&&!created&&GuardEmpty(guardRoot)){if(!Flag(command,"create"))throw new GuardFailure("nonprivate-runtime-requires-migration");guardRoot=GuardReplaceEmpty(parent,Path.GetFileName(guardPath),guardRoot,security);created=true;}
   try{guardPin=GuardOpen(guardRoot,"owner.lock",false,guardMappedUser!=null&&!created?1u:3u,0,security);}catch(Win32Exception error){if(guardMappedUser!=null&&!created&&(error.NativeErrorCode==2||error.NativeErrorCode==3))throw new GuardFailure("nonprivate-runtime-requires-migration");throw;}GuardAcl(guardPin);guardPinStream=new FileStream(guardPin,FileAccess.ReadWrite,4096,false);
   expected=GuardStamp(GuardAcl(guardRoot));bool cached=GuardStamped(expected);if(guardMappedUser!=null&&!created&&!cached)throw new GuardFailure("nonprivate-runtime-requires-migration");if(!created&&!cached)GuardInspectTree(guardRoot);
   if(!cached){GuardSetPrivate(guardRoot,security);GuardAcl(guardRoot);byte[] stamp=ProtectedData.Protect(Encoding.UTF8.GetBytes(GuardStamp(GuardAcl(guardRoot))),null,DataProtectionScope.CurrentUser);guardPinStream.Position=0;guardPinStream.Write(stamp,0,stamp.Length);guardPinStream.SetLength(stamp.Length);guardPinStream.Flush(true);}
   if(!SetHandleInformation(guardPin.DangerousGetHandle(),1,1))throw new Win32Exception();
   Root(guardPath);var named=directories[next];if(Identity(Information(named,true))!=Identity(Information(guardRoot,true)))throw new Failure("STORAGE_COPY");
   // Admission needs WRITE_DAC/DELETE, but retaining a writable directory open
   // can prevent ordinary child renames on SMB. The live file pin protects the
   // namespace while the identity-checked read handle becomes the runtime root.
   guardRoot.Dispose();guardRoot=named;directories.Remove(next);
   guardJob=CreateJobObject(IntPtr.Zero,null);if(guardJob==IntPtr.Zero)throw new Win32Exception();var limits=new ExtendedLimits{Basic=new BasicLimits{Flags=0x2000}};if(!SetInformationJobObject(guardJob,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))))throw new Win32Exception();
   guardNull=CreateFile("NUL",0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);if(guardNull.IsInvalid||!SetHandleInformation(guardNull.DangerousGetHandle(),1,1))throw new Win32Exception();
   foreach(int kind in new int[]{-10,-11,-12})if(!SetHandleInformation(GetStdHandle(kind),1,0))throw new Win32Exception();
   return new {identity=Identity(Information(guardRoot,true)),cached=cached,created=created};
  }
  static string GuardQuote(string value){if(value.IndexOf('\0')>=0)throw new Failure("INVALID");var result=new StringBuilder("\"");int slashes=0;foreach(char ch in value){if(ch=='\\'){slashes++;continue;}if(ch=='\"'){result.Append('\\',slashes*2+1);result.Append(ch);}else{result.Append('\\',slashes);result.Append(ch);}slashes=0;}result.Append('\\',slashes*2);return result.Append('"').ToString();}
  static void GuardRenameSibling(SafeFileHandle file,string name,bool replace=false){
   // With a null RootDirectory and a simple name, the kernel uses the source
   // handle's own parent. This remains descriptor-bound on SMB redirectors.
   Name(name);byte[] bytes=Encoding.Unicode.GetBytes(name);int offset=IntPtr.Size==8?20:12;IntPtr data=Marshal.AllocHGlobal(offset+bytes.Length);
   try{for(int i=0;i<offset+bytes.Length;i++)Marshal.WriteByte(data,i,0);if(replace)Marshal.WriteByte(data,1);Marshal.WriteInt32(data,IntPtr.Size==8?16:8,bytes.Length);Marshal.Copy(bytes,0,IntPtr.Add(data,offset),bytes.Length);IoStatus status;Native(NtSetInformationFile(file,out status,data,(uint)(offset+bytes.Length),10));}
   finally{Marshal.FreeHGlobal(data);}
  }
  sealed class GuardMember:IDisposable {
   public SafeFileHandle Parent;public string Name;List<SafeFileHandle> opened=new List<SafeFileHandle>();
   public GuardMember(string relative){if(guardRoot==null||guardClosing||String.IsNullOrEmpty(relative)||relative.IndexOf('\\')>=0)throw new Failure("UNSAFE");string[] parts=relative.Split('/');foreach(string part in parts)MutationFiles.Name(part);Name=parts[parts.Length-1];Parent=guardRoot;try{for(int i=0;i<parts.Length-1;i++){Parent=Open(Parent,parts[i],true,0x80000000);opened.Add(Parent);}}catch{Dispose();throw;}}
   public void Dispose(){for(int i=opened.Count-1;i>=0;i--)opened[i].Dispose();opened.Clear();}
  }
  static void GuardRemoveTree(SafeFileHandle parent,string name){
   using(var folder=Open(parent,name,true,0x80010000)){
    bool restart=true;for(;;){var page=json.Deserialize<Dictionary<string,object>>(json.Serialize(List(folder,restart)));restart=false;foreach(Dictionary<string,object> entry in (ArrayList)page["entries"]){string member=(string)entry["name"];if((bool)entry["directory"])GuardRemoveTree(folder,member);else using(var file=Open(folder,member,false,0x80010000)){Information(file,false);Delete(file);}}if((bool)page["done"])break;}
    Delete(folder);
   }
  }
  static object GuardFileOperation(Dictionary<string,object> command){
   using(var member=new GuardMember(Text(command,"relative"))){string action=Text(command,"action");
    if(action=="write"){
     byte[] bytes=Convert.FromBase64String(Text(command,"data"));if(bytes.Length>16384)throw new Failure("INVALID");string temporary=".runtime-write-"+Guid.NewGuid().ToString("N"),identity=null;SafeFileHandle handle=null;FileStream stream=null;bool complete=false;
     try{handle=GuardOpen(member.Parent,temporary,false,2,7,null,0xC0170080);identity=Identity(Information(handle,false));stream=new FileStream(handle,FileAccess.ReadWrite,4096,false);stream.Write(bytes,0,bytes.Length);stream.Flush(true);stream.Dispose();stream=null;handle=null;
      // SMB servers may reject rename while a writable handle is open. Reopen
      // relative to the retained parent and bind publication to the saved inode.
      using(var publication=Open(member.Parent,temporary,false,0x80010000)){if(Identity(Information(publication,false))!=identity)throw new Failure("CONFLICT");try{GuardRenameSibling(publication,member.Name,true);}catch(Exception error){error.Data["runtimePhase"]="state-publication";throw;}}complete=true;return new {ok=true};}
     finally{Array.Clear(bytes,0,bytes.Length);if(stream!=null)stream.Dispose();else if(handle!=null)handle.Dispose();if(!complete&&identity!=null)try{using(var pending=Open(member.Parent,temporary,false,0x80010000)){if(Identity(Information(pending,false))==identity)Delete(pending);}}catch{}}
    }
    if(action=="remove-tree"){GuardRemoveTree(member.Parent,member.Name);return new {ok=true};}
    bool folder=Flag(command,"folder");using(var handle=Open(member.Parent,member.Name,folder,0x80000000|((action=="rename"||action=="unlink")?0x10000u:0))){Info info=Information(handle,folder);
     if(action=="stat")return new {size=Bytes(info),identity=Identity(info)};
     if(action=="read"){int limit=Number(command,"limit");if(limit<0||limit>16384||Bytes(info)>limit)throw new Failure("LIMIT");using(var stream=new FileStream(handle,FileAccess.Read,4096,false)){byte[] bytes=new byte[(int)Bytes(info)];int offset=0;while(offset<bytes.Length){int count=stream.Read(bytes,offset,bytes.Length-offset);if(count==0)throw new Failure("CONFLICT");offset+=count;}if(stream.ReadByte()!=-1)throw new Failure("CONFLICT");try{return new {data=Convert.ToBase64String(bytes)};}finally{Array.Clear(bytes,0,bytes.Length);}}}
     if(action=="unlink"){Delete(handle);return new {ok=true};}
     if(action=="rename"){try{using(var target=new GuardMember(Text(command,"target"))){if(Identity(Information(member.Parent,true))!=Identity(Information(target.Parent,true)))throw new Failure("UNSAFE");GuardRenameSibling(handle,target.Name);}}catch(Exception error){error.Data["runtimePhase"]="directory-publication";throw;}return new {ok=true};}
     throw new Failure("INVALID");
    }
   }
  }
  static void GuardLaunch(Dictionary<string,object> command,int id){
   lock(guardState){if(guardRoot==null||guardClosing||guardChild!=IntPtr.Zero)throw new Failure("INVALID");string executable=Text(command,"command");if(!Path.IsPathRooted(executable))throw new Failure("UNSAFE");var args=(ArrayList)command["args"];var text=new StringBuilder(GuardQuote(executable));foreach(object item in args){if(!(item is string))throw new Failure("INVALID");text.Append(' ').Append(GuardQuote((string)item));}
    SafeFileHandle captured=null;FileStream capture=null;
    try{
     if(Flag(command,"capture")){captured=GuardOpen(guardRoot,".runtime-output-"+Guid.NewGuid().ToString("N"),false,2,7,null,0xC0170080);Delete(captured);if(!SetHandleInformation(captured.DangerousGetHandle(),1,1))throw new Win32Exception();capture=new FileStream(captured,FileAccess.ReadWrite,4096,false);}
     var startup=new Startup{Size=(uint)Marshal.SizeOf(typeof(Startup)),Flags=0x100,Input=guardNull.DangerousGetHandle(),Output=captured==null?guardNull.DangerousGetHandle():captured.DangerousGetHandle(),Error=guardNull.DangerousGetHandle()};ProcessInfo process;
     if(!CreateProcessW(executable,text,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,guardPath,ref startup,out process))throw new Win32Exception();
     try{if(!AssignProcessToJobObject(guardJob,process.Process))throw new Win32Exception();if(ResumeThread(process.Thread)==0xffffffff)throw new Win32Exception();guardChild=process.Process;}catch{TerminateProcess(process.Process,1);CloseHandle(process.Process);throw;}finally{CloseHandle(process.Thread);}
     guardThread=new Thread(()=>{uint code=1;string stdout="";try{WaitForSingleObject(process.Process,0xffffffff);GetExitCodeProcess(process.Process,out code);if(capture!=null){byte[] bytes=new byte[8192];capture.Position=0;int count=capture.Read(bytes,0,bytes.Length);stdout=Encoding.UTF8.GetString(bytes,0,count);}}catch{code=1;}finally{if(capture!=null)capture.Dispose();lock(guardState){CloseHandle(process.Process);guardChild=IntPtr.Zero;}}GuardSend(new {id=id,result=new {exitCode=code,stdout=stdout}});});guardThread.IsBackground=true;guardThread.Start();
    }catch{if(capture!=null)capture.Dispose();else if(captured!=null)captured.Dispose();throw;}
   }
  }
  static void GuardStop(){if(guardJob==IntPtr.Zero)return;if(!TerminateJobObject(guardJob,1))throw new Win32Exception();for(;;){JobAccounting value;if(!QueryInformationJobObject(guardJob,1,out value,(uint)Marshal.SizeOf(typeof(JobAccounting)),IntPtr.Zero))throw new Win32Exception();if(value.Active==0)break;Thread.Sleep(10);}var thread=guardThread;if(thread!=null)thread.Join();}
  public static void RunPostgresGuard(){
   input=Console.OpenStandardInput();rawOutput=Console.OpenStandardOutput();output=new StreamWriter(rawOutput,new UTF8Encoding(false));GuardSend(new {ready=true});
   try{using(var reader=new StreamReader(input,new UTF8Encoding(false,true))){string line;while((line=reader.ReadLine())!=null){if(line.Length>131072)throw new Failure("INVALID");int id=0;try{var command=json.Deserialize<Dictionary<string,object>>(line);id=Number(command,"id");string operation=Text(command,"operation");if(operation=="admit")GuardSend(new {id=id,result=GuardAdmit(command)});else if(operation=="inspect")GuardSend(new {id=id,result=GuardInspectStorage(command)});else if(operation=="probe-create")GuardSend(new {id=id,result=GuardProbeCreate(command)});else if(operation=="file")GuardSend(new {id=id,result=GuardFileOperation(command)});else if(operation=="run")GuardLaunch(command,id);else if(operation=="cancel"){GuardStop();GuardSend(new {id=id,result=new {stopped=true}});}else if(operation=="close"){guardClosing=true;GuardStop();GuardSend(new {id=id,result=new {stopped=true}});break;}else throw new Failure("INVALID");}catch(Exception error){var failure=error as Failure;GuardSend(new {id=id,error=failure==null?Error(error):failure.Code,reason=error is GuardFailure?error.Message:null,diagnostic=error.ToString()+" phase="+Convert.ToString(error.Data["runtimePhase"])});}}}}
   finally{guardClosing=true;try{GuardStop();}finally{if(guardJob!=IntPtr.Zero)CloseHandle(guardJob);if(guardNull!=null)guardNull.Dispose();if(guardPinStream!=null)guardPinStream.Dispose();else if(guardPin!=null)guardPin.Dispose();if(guardRoot!=null)guardRoot.Dispose();foreach(var handle in directories.Values)handle.Dispose();directories.Clear();}}
  }
 }
}
