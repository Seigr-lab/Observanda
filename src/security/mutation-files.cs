// All descendant names are resolved relative to opened directory handles.
// Never reconstruct an absolute path after admission: junctions can change in
// place even while a Windows process has that directory as its current folder.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace Observanda {
 public static class MutationFiles {
  [StructLayout(LayoutKind.Sequential)] struct Unicode {public ushort Length,MaximumLength;public IntPtr Buffer;}
  [StructLayout(LayoutKind.Sequential)] struct Attributes {public uint Length;public IntPtr RootDirectory,ObjectName;public uint Flags;public IntPtr SecurityDescriptor,SecurityQuality;}
  [StructLayout(LayoutKind.Sequential)] struct IoStatus {public IntPtr Status,Information;}
  [StructLayout(LayoutKind.Sequential)] struct Info {public uint Attributes;public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
  [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle handle,uint access,ref Attributes attributes,out IoStatus status,IntPtr allocation,uint fileAttributes,uint share,uint disposition,uint options,IntPtr ea,uint eaLength);
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle handle,out IoStatus status,IntPtr data,uint length,int kind);
  [DllImport("ntdll.dll")] static extern int NtQueryDirectoryFile(SafeFileHandle handle,IntPtr evt,IntPtr apc,IntPtr context,out IoStatus status,IntPtr data,uint length,int kind,[MarshalAs(UnmanagedType.U1)]bool single,IntPtr pattern,[MarshalAs(UnmanagedType.U1)]bool restart);
  static Dictionary<int,SafeFileHandle> directories=new Dictionary<int,SafeFileHandle>();
  static int next=0;
  static Stream input;
  static StreamWriter output;
  static bool inputPayload=false;
  // Commands are serialized. Reuse one bounded transfer buffer, clearing it
  // after each file, instead of allocating a large object for every small file.
  static readonly byte[] transferBuffer=new byte[1048576];
  static JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=262144,RecursionLimit=16};
  class Failure:Exception {public string Code;public Failure(string code){Code=code;}}
  static void Native(int code){if(code<0)throw new Win32Exception((int)RtlNtStatusToDosError(code));}
  static string Error(Exception error){
   Failure failure=error as Failure;if(failure!=null)return failure.Code;
   Win32Exception native=error as Win32Exception;int code=native==null?error.HResult&65535:native.NativeErrorCode;
   if(code==2||code==3)return "ENOENT";if(code==5)return "EACCES";if(code==80||code==183)return "EEXIST";if(code==112||code==39)return "ENOSPC";if(code==145)return "ENOTEMPTY";if(code==32||code==33)return "EBUSY";
   return "UNSAFE";
  }
  static string Text(Dictionary<string,object> command,string key){object value;if(!command.TryGetValue(key,out value)||!(value is string))throw new Failure("INVALID");return (string)value;}
  static bool Flag(Dictionary<string,object> command,string key){object value;return command.TryGetValue(key,out value)&&value is bool&&(bool)value;}
  static int Number(Dictionary<string,object> command,string key){object value;if(!command.TryGetValue(key,out value)||!(value is int))throw new Failure("INVALID");return (int)value;}
  static long Size(Dictionary<string,object> command){object value;if(!command.TryGetValue("bytes",out value)||!(value is int||value is long)||Convert.ToInt64(value)<0||Convert.ToInt64(value)>9007199254740991L)throw new Failure("INVALID");return Convert.ToInt64(value);}
  static string Name(string name){
   if(name.Length==0||name.Length>255||name=="."||name==".."||name.EndsWith(".")||name.EndsWith(" ")||name.IndexOfAny(new char[]{'\\','/',':','\0','<','>','"','|','?','*'})>=0)throw new Failure("UNSAFE");
   foreach(char c in name)if(c<32)throw new Failure("UNSAFE");return name;
  }
  static Info Information(SafeFileHandle handle,bool directory,bool links=false){Info info;if(!GetFileInformationByHandle(handle,out info))throw new Win32Exception();if((info.Attributes&0x400)!=0||((info.Attributes&0x10)!=0)!=directory||!directory&&(info.Links<1||info.Links>(links?2:1)))throw new Failure("UNSAFE");return info;}
  static SafeFileHandle Directory(Dictionary<string,object> command,string key="directory",bool validate=true){SafeFileHandle value;if(!directories.TryGetValue(Number(command,key),out value))throw new Failure("UNSAFE");if(validate)Information(value,true);return value;}
  static SafeFileHandle Open(SafeFileHandle parent,string name,bool directory,uint access,uint disposition=1){
   Name(name);Information(parent,true);IntPtr buffer=Marshal.StringToHGlobalUni(name),unicode=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode)));
   try{Marshal.StructureToPtr(new Unicode{Length=(ushort)(name.Length*2),MaximumLength=(ushort)(name.Length*2+2),Buffer=buffer},unicode,false);
    var attrs=new Attributes{Length=(uint)Marshal.SizeOf(typeof(Attributes)),RootDirectory=parent.DangerousGetHandle(),ObjectName=unicode,Flags=0x40};IoStatus status;SafeFileHandle result;
    int code=NtCreateFile(out result,access|0x100000|0x80,ref attrs,out status,IntPtr.Zero,0x80,7,disposition,0x200000|0x20|(directory?1u:0x40u),IntPtr.Zero,0);
    if(code<0){if(result!=null)result.Dispose();Native(code);}try{Information(result,directory,true);return result;}catch{result.Dispose();throw;}
   }finally{Marshal.FreeHGlobal(unicode);Marshal.FreeHGlobal(buffer);}
  }
  static object Saved(SafeFileHandle handle){int id=++next;directories.Add(id,handle);return new {id=id,identity=Identity(Information(handle,true))};}
  static string Identity(Info info){return info.Volume.ToString()+":"+(((ulong)info.IndexHigh<<32)|info.IndexLow).ToString();}
  static long Bytes(Info info){return ((long)info.SizeHigh<<32)|info.SizeLow;}
  static bool Same(Info a,Info b){return Identity(a)==Identity(b)&&Bytes(a)==Bytes(b)&&a.Written.dwHighDateTime==b.Written.dwHighDateTime&&a.Written.dwLowDateTime==b.Written.dwLowDateTime;}
  static string Digest(byte[] bytes){return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
  static object Root(string value){
   if(!Path.IsPathRooted(value)||value.StartsWith("\\\\?\\")||value.StartsWith("\\\\.\\"))throw new Failure("UNSAFE");
   string full=Path.GetFullPath(value),root=Path.GetPathRoot(full);SafeFileHandle current=CreateFile(root,0x80000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
   try{if(current.IsInvalid)throw new Win32Exception();Information(current,true);
    foreach(string part in full.Substring(root.Length).Split(new char[]{'\\','/'},StringSplitOptions.RemoveEmptyEntries)){SafeFileHandle child=Open(current,part,true,0x80000000);current.Dispose();current=child;}
    object result=Saved(current);current=null;return result;
   }finally{if(current!=null)current.Dispose();}
  }
  static object Hash(SafeFileHandle parent,string name,bool links){using(var handle=Open(parent,name,false,0x80000000)){
   Info before=Information(handle,false,links);using(var stream=new FileStream(handle,FileAccess.Read,(int)Math.Min(65536,Math.Max(Bytes(before),4096)),false))using(var sha=SHA256.Create()){
    string digest=Digest(sha.ComputeHash(stream));Info after=Information(handle,false,links);if(!Same(before,after))throw new Failure("LOCAL_EXPORT_CHANGED");return new {bytes=Bytes(after),sha256=digest,identity=Identity(after),links=after.Links};
   }
  }}
  static object Read(SafeFileHandle parent,Dictionary<string,object> command){using(var handle=Open(parent,Text(command,"name"),false,0x80000000)){
   Info before=Information(handle,false);int limit=Number(command,"limit");if(limit<0||limit>65536||Bytes(before)>limit)throw new Failure("UNSAFE");
   using(var stream=new FileStream(handle,FileAccess.Read,65536,false)){
    byte[] bytes=new byte[(int)Bytes(before)];int position=0;while(position<bytes.Length){int count=stream.Read(bytes,position,bytes.Length-position);if(count==0)throw new Failure("CONFLICT");position+=count;}
    if(stream.ReadByte()!=-1||!Same(before,Information(handle,false)))throw new Failure("CONFLICT");return new {data=Convert.ToBase64String(bytes),identity=Identity(before)};
   }
  }}
  static void Rename(SafeFileHandle file,SafeFileHandle parent,string name,int kind){
   Name(name);Information(parent,true);byte[] bytes=Encoding.Unicode.GetBytes(name);int offset=IntPtr.Size==8?20:12;IntPtr data=Marshal.AllocHGlobal(offset+bytes.Length);
   try{for(int i=0;i<offset+bytes.Length;i++)Marshal.WriteByte(data,i,0);Marshal.WriteIntPtr(data,IntPtr.Size==8?8:4,parent.DangerousGetHandle());Marshal.WriteInt32(data,IntPtr.Size==8?16:8,bytes.Length);Marshal.Copy(bytes,0,IntPtr.Add(data,offset),bytes.Length);IoStatus status;Native(NtSetInformationFile(file,out status,data,(uint)(offset+bytes.Length),kind));}
   finally{Marshal.FreeHGlobal(data);}
  }
  static void Delete(SafeFileHandle file){IntPtr data=Marshal.AllocHGlobal(1);try{Marshal.WriteByte(data,1);IoStatus status;Native(NtSetInformationFile(file,out status,data,1,13));}finally{Marshal.FreeHGlobal(data);}}
  static void Expected(Dictionary<string,object> command,Info info){object expected;if(command.TryGetValue("identity",out expected)&&expected!=null&&(! (expected is string)|| (string)expected!=Identity(info)))throw new Failure("CONFLICT");}
  static object List(SafeFileHandle handle,bool restart){
   IntPtr data=Marshal.AllocHGlobal(65536);try{IoStatus status;int code=NtQueryDirectoryFile(handle,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,out status,data,65536,1,false,IntPtr.Zero,restart);
    if((uint)code==0x80000006u)return new {done=true,entries=new object[0]};Native(code);int count=(int)status.Information;var entries=new List<object>();
    for(int offset=0;offset<count;){if(offset+64>count)throw new Failure("UNSAFE");int length=Marshal.ReadInt32(data,offset+60),nextOffset=Marshal.ReadInt32(data,offset);uint attributes=(uint)Marshal.ReadInt32(data,offset+56);
     if(length<0||length%2!=0||offset+64+length>count)throw new Failure("UNSAFE");string name=Marshal.PtrToStringUni(IntPtr.Add(data,offset+64),length/2);
     if(name!="."&&name!=".."){Name(name);if((attributes&0x400)!=0)throw new Failure("UNSAFE");entries.Add(new {name=name,directory=(attributes&0x10)!=0});}
     if(nextOffset==0)break;if(nextOffset<64||nextOffset%8!=0)throw new Failure("UNSAFE");offset+=nextOffset;
    }
    return new {done=false,entries=entries};
   }finally{Marshal.FreeHGlobal(data);}
  }
  static void Send(object value){output.WriteLine(json.Serialize(value));output.Flush();}
  static object Transfer(Dictionary<string,object> command,bool copy){
   SafeFileHandle source=null,destination=null;bool complete=false;Info before=new Info();
   long expected=Size(command),received=0;string expectedHash=Text(command,"sha256");if(expectedHash.Length!=64)throw new Failure("INVALID");
   try{
    if(copy){source=Open(Directory(command,"sourceDirectory"),Text(command,"source"),false,0x80000000);before=Information(source,false);if(Bytes(before)!=expected)throw new Failure("STORAGE_COPY");}
    destination=Open(Directory(command),Text(command,"name"),false,0x40000000|0x10000,2);
    if(!copy){inputPayload=true;Send(new {ready=true});}
    int buffering=(int)Math.Min(65536,Math.Max(expected,4096));using(var target=new FileStream(destination,FileAccess.Write,buffering,false))using(var sha=SHA256.Create()){
     Stream origin=copy?new FileStream(source,FileAccess.Read,buffering,false):input;byte[] buffer=transferBuffer;long reported=0;
     try{while(received<expected){int count=origin.Read(buffer,0,(int)Math.Min(buffer.Length,expected-received));if(count==0)throw new EndOfStreamException();target.Write(buffer,0,count);sha.TransformBlock(buffer,0,count,null,0);received+=count;
       if(received-reported>=8388608){Send(new {progress=received});reported=received;}
      }
      inputPayload=false;sha.TransformFinalBlock(new byte[0],0,0);if(Digest(sha.Hash)!=expectedHash||copy&&(!Same(before,Information(source,false))||origin.ReadByte()!=-1))throw new Failure("STORAGE_COPY");target.Flush(true);complete=true;return new {bytes=received,sha256=expectedHash};
     }finally{Array.Clear(buffer,0,(int)Math.Min(expected,buffer.Length));if(copy)origin.Dispose();if(!complete)try{Delete(destination);}catch{}}
    }
   }finally{if(source!=null)source.Dispose();if(destination!=null)destination.Dispose();}
  }
  static object Execute(Dictionary<string,object> command){
   string operation=Text(command,"operation");if(operation=="root")return Root(Text(command,"path"));
   SafeFileHandle parent=Directory(command,"directory",operation!="close");
   if(operation=="close"){directories.Remove(Number(command,"directory"));parent.Dispose();return new {ok=true};}
   if(operation=="directory")return Saved(Open(parent,Text(command,"name"),true,0x80000000,Flag(command,"create")?3u:1u));
   if(operation=="list")return List(parent,Flag(command,"restart"));
   if(operation=="hash")return Hash(parent,Text(command,"name"),Flag(command,"links"));
   if(operation=="read")return Read(parent,command);
   if(operation=="write"||operation=="copy")return Transfer(command,operation=="copy");
   bool folder=Flag(command,"folder");using(var file=Open(parent,Text(command,"name"),folder,0x80000000|(operation=="stat"?0u:0x10000u))){
    Info info=Information(file,folder,Flag(command,"links"));Expected(command,info);
    if(operation=="stat")return new {bytes=Bytes(info),identity=Identity(info),links=info.Links};
    if(operation=="delete"){Delete(file);return new {ok=true};}
    if(operation=="rename"||operation=="link"){if(operation=="link"&&folder)throw new Failure("UNSAFE");Rename(file,Directory(command,"targetDirectory"),Text(command,"target"),operation=="rename"?10:11);return new {ok=true};}
    throw new Failure("INVALID");
   }
  }
  public static void Run(){
   input=Console.OpenStandardInput();output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false));Send(new {ready=true});
   try{for(;;){var line=new MemoryStream();for(;;){int value=input.ReadByte();if(value<0){if(line.Length!=0)throw new EndOfStreamException();return;}if(value==10)break;if(line.Length>=65536)throw new Failure("INVALID");line.WriteByte((byte)value);}
     try{var command=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(line.ToArray()));Send(new {result=Execute(command)});}
     catch(Exception error){Send(new {error=Error(error)});if(inputPayload)return;}
    }
   }finally{foreach(var handle in directories.Values)handle.Dispose();directories.Clear();}
  }
 }
}
