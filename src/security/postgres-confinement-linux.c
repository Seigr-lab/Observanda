#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/mount.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <unistd.h>

/* The database and all descendants see only this private mount tree. In
 * particular, pathname races cannot redirect metadata writes to the host tree.
 * Every mount source is opened without links inside the private namespace;
 * the database identity was admitted by the caller before launch. */
static void fail(const char *stage) { fprintf(stderr,"PostgreSQL confinement unavailable (%s, %d).\n",stage,errno); exit(125); }
static int checked(int result,const char *stage) { if(result<0)fail(stage);return result; }
static void write_all(int fd,const char *text) { size_t left=strlen(text);while(left){ssize_t n=write(fd,text,left);if(n<=0)fail("write");text+=n;left-=(size_t)n;} }
static int open_path(const char *path,int flags) {
 if(!path||path[0]!='/'||strlen(path)>4095){errno=EINVAL;fail("path");}
 int fd=checked(open("/",O_PATH|O_DIRECTORY|O_CLOEXEC),"root");char *copy=strdup(path+1),*save=NULL;
 if(!copy)fail("allocation");
 char *part=strtok_r(copy,"/",&save);
 while(part){if(!strcmp(part,".")||!strcmp(part,"..")){errno=EINVAL;fail("component");}char *next=strtok_r(NULL,"/",&save);int child=openat(fd,part,O_NOFOLLOW|O_CLOEXEC|(next?O_PATH|O_DIRECTORY:flags));int saved=errno;close(fd);errno=saved;if(child<0){free(copy);return -1;}fd=child;part=next;}
 free(copy);return fd;
}
static void file_text_at(int parent,const char *name,const char *text,mode_t mode) { int fd=checked(openat(parent,name,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,mode),"configuration");write_all(fd,text);checked(close(fd),"close"); }
static void proc_text(const char *name,const char *text) { int fd=checked(open(name,O_WRONLY|O_CLOEXEC),"identity map");write_all(fd,text);checked(close(fd),"close"); }
struct source { const char *path,*target;int directory,optional,fd,device; };
static void attributes(int fd,uint64_t flags) { struct mount_attr attr={.attr_set=flags};checked((int)syscall(SYS_mount_setattr,fd,"",AT_EMPTY_PATH|AT_RECURSIVE,&attr,sizeof(attr)),"mount attributes"); }
static void mount_source(int source,int root,const char *target,int directory,uint64_t flags) {
 if(directory)checked(mkdirat(root,target,0755),"mount directory");else {int fd=checked(openat(root,target,O_CREAT|O_EXCL|O_WRONLY|O_CLOEXEC,0600),"mount file");close(fd);}
 unsigned int clone_flags=AT_EMPTY_PATH|OPEN_TREE_CLONE|OPEN_TREE_CLOEXEC;
 if(directory&&(flags&MOUNT_ATTR_RDONLY))clone_flags|=AT_RECURSIVE;
 int tree=(int)syscall(SYS_open_tree,source,"",clone_flags);if(tree<0)fail(target);attributes(tree,flags);
 checked((int)syscall(SYS_move_mount,tree,"",root,target,MOVE_MOUNT_F_EMPTY_PATH),"attach mount");close(tree);
}
static void drop_privileges(void) {
 for(int capability=0;capability<=CAP_LAST_CAP;capability++)checked(prctl(PR_CAPBSET_DROP,capability,0,0,0),"bounding capabilities");
 struct __user_cap_header_struct header={.version=_LINUX_CAPABILITY_VERSION_3,.pid=0};struct __user_cap_data_struct data[2]={{0},{0}};
 checked((int)syscall(SYS_capset,&header,&data),"capabilities");checked(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0),"no new privileges");
}
#define DENY(number) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,(number),0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM)
static void syscall_filter(void) {
#if defined(__x86_64__)
 const unsigned int architecture=AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
 const unsigned int architecture=AUDIT_ARCH_AARCH64;
#else
#error Unsupported confinement architecture
#endif
 struct sock_filter instructions[]={
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,architecture,1,0),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
#if defined(__x86_64__)
  BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,0x40000000,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
#endif
  DENY(SYS_mount),DENY(SYS_umount2),DENY(SYS_pivot_root),DENY(SYS_chroot),DENY(SYS_open_tree),DENY(SYS_move_mount),DENY(SYS_fsopen),DENY(SYS_fsconfig),DENY(SYS_fsmount),DENY(SYS_mount_setattr),DENY(SYS_unshare),DENY(SYS_setns),DENY(SYS_open_by_handle_at),DENY(SYS_ptrace),DENY(SYS_process_vm_readv),DENY(SYS_process_vm_writev),DENY(SYS_pidfd_getfd),DENY(SYS_bpf),DENY(SYS_perf_event_open),DENY(SYS_io_uring_setup),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_clone3,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|ENOSYS),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_clone,0,3),BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,CLONE_NEWUSER|CLONE_NEWNS|CLONE_NEWPID|CLONE_NEWNET|CLONE_NEWIPC|CLONE_NEWUTS|CLONE_NEWCGROUP,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_socket,0,3),BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,1,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
  BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
 };struct sock_fprog program={.len=(unsigned short)(sizeof(instructions)/sizeof(instructions[0])),.filter=instructions};checked(prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&program),"syscall filter");
}
int main(int argc,char **argv) {
 /* Only captured process pipes and /dev/null may cross the boundary. Never
  * write even a diagnostic through an unexpected inherited host file. */
 for(int fd=0;fd<3;fd++){struct stat value;if(fstat(fd,&value)<0)return 125;if(S_ISFIFO(value.st_mode))continue;if(S_ISCHR(value.st_mode)&&value.st_rdev==makedev(1,3))continue;if(S_ISSOCK(value.st_mode)){int domain=0,type=0;socklen_t length=sizeof(domain);if(getsockopt(fd,SOL_SOCKET,SO_DOMAIN,&domain,&length)==0&&domain==AF_UNIX&&getsockopt(fd,SOL_SOCKET,SO_TYPE,&type,&length)==0&&type==SOCK_STREAM)continue;}return 125;}
 int probe=argc==4&&!strcmp(argv[3],"--probe");
 if(!probe&&(argc<5||strcmp(argv[3],"--"))){errno=EINVAL;fail("arguments");}
 const char *command=probe?"/usr/bin/true":argv[4];
 uid_t uid=getuid();gid_t gid=getgid();if(!uid||geteuid()!=uid||getegid()!=gid){errno=EPERM;fail("user");}
 checked(unshare(CLONE_NEWUSER|CLONE_NEWNS|CLONE_NEWIPC),"private namespaces");char mapping[96];proc_text("/proc/self/setgroups","deny");snprintf(mapping,sizeof(mapping),"%u %u 1\n",uid,uid);proc_text("/proc/self/uid_map",mapping);snprintf(mapping,sizeof(mapping),"%u %u 1\n",gid,gid);proc_text("/proc/self/gid_map",mapping);
 checked(mount(NULL,"/",NULL,MS_REC|MS_PRIVATE,NULL),"private propagation");
 int runtime=checked(open_path(argv[1],O_RDONLY|O_DIRECTORY),"runtime directory");struct stat st;checked(fstat(runtime,&st),"runtime identity");char identity[96];snprintf(identity,sizeof(identity),"%llu:%llu",(unsigned long long)st.st_dev,(unsigned long long)st.st_ino);
 if(strcmp(identity,argv[2])||st.st_uid!=uid||(st.st_mode&077)){errno=EPERM;fail("runtime identity");}
 char *bin=strdup(command),*slash=bin?strrchr(bin,'/'):NULL;if(!slash||slash==bin||!slash[1]){errno=EINVAL;fail("executable");}char *program=strdup(slash+1);*slash=0;
 int executable=checked(open_path(command,O_RDONLY),"executable");checked(fstat(executable,&st),"executable identity");if(!S_ISREG(st.st_mode)||(st.st_mode&0022)){errno=EPERM;fail("executable permissions");}close(executable);
 int binfd=checked(open_path(bin,O_RDONLY|O_DIRECTORY),"runtime executables");char *package=strdup(bin),*end=package?strrchr(package,'/'):NULL;if(!end){errno=EINVAL;fail("runtime package");}*end=0;
 char lib[4096],share[4096];if(snprintf(lib,sizeof(lib),"%s/lib",package)>=(int)sizeof(lib)||snprintf(share,sizeof(share),"%s/share",package)>=(int)sizeof(share)){errno=EINVAL;fail("package path");}
 struct source sources[]={
  {lib,"runtime/lib",1,1,-1,0},{share,"runtime/share",1,1,-1,0},
  {"/usr/lib","usr/lib",1,0,-1,0},{"/usr/lib64","usr/lib64",1,1,-1,0},
  {"/usr/bin/dash","bin/sh",0,0,-1,0},{"/usr/share/locale","usr/share/locale",1,1,-1,0},{"/usr/share/zoneinfo","usr/share/zoneinfo",1,1,-1,0},{"/usr/share/postgresql","usr/share/postgresql",1,1,-1,0},{"/usr/share/icu","usr/share/icu",1,1,-1,0},
  {"/etc/ld.so.cache","etc/ld.so.cache",0,1,-1,0},{"/dev/null","dev/null",0,0,-1,1},{"/dev/urandom","dev/urandom",0,0,-1,1}
 };size_t count=sizeof(sources)/sizeof(sources[0]);for(size_t i=0;i<count;i++){struct source *s=&sources[i];s->fd=open_path(s->path,O_PATH|(s->directory?O_DIRECTORY:0));if(s->fd<0){if(s->optional&&errno==ENOENT)continue;fail("system dependency");}checked(fstat(s->fd,&st),"dependency identity");if((s->device&&!S_ISCHR(st.st_mode))||(!s->directory&&!s->device&&!S_ISREG(st.st_mode))){errno=EINVAL;fail("dependency type");}}
 int filesystem=checked((int)syscall(SYS_fsopen,"tmpfs",FSOPEN_CLOEXEC),"private root filesystem");checked((int)syscall(SYS_fsconfig,filesystem,FSCONFIG_SET_STRING,"mode","0755",0),"root mode");checked((int)syscall(SYS_fsconfig,filesystem,FSCONFIG_CMD_CREATE,NULL,NULL,0),"create root");int root=checked((int)syscall(SYS_fsmount,filesystem,FSMOUNT_CLOEXEC,MOUNT_ATTR_NOSUID|MOUNT_ATTR_NODEV),"private root");close(filesystem);
 /* Older supported kernels require the destination mount to belong to the
  * current namespace before another detached mount can be attached to it.
  * Covering /tmp in this private namespace changes no host directory entry. */
 int temporary=checked(open_path("/tmp",O_PATH|O_DIRECTORY),"private root mountpoint");checked((int)syscall(SYS_move_mount,root,"",temporary,"",MOVE_MOUNT_F_EMPTY_PATH|MOVE_MOUNT_T_EMPTY_PATH),"attach private root");close(temporary);
 const char *directories[]={"runtime","usr","usr/share","bin","etc","dev","tmp"};for(size_t i=0;i<sizeof(directories)/sizeof(directories[0]);i++)checked(mkdirat(root,directories[i],0755),"root skeleton");
 checked(symlinkat("usr/lib",root,"lib"),"loader alias");checked(symlinkat("usr/lib64",root,"lib64"),"loader alias");
 mount_source(runtime,root,"observanda",1,MOUNT_ATTR_NOSUID|MOUNT_ATTR_NODEV|MOUNT_ATTR_NOEXEC|MOUNT_ATTR_NOSYMFOLLOW);close(runtime);
 mount_source(binfd,root,"runtime/bin",1,MOUNT_ATTR_RDONLY|MOUNT_ATTR_NOSUID|MOUNT_ATTR_NODEV);close(binfd);
 for(size_t i=0;i<count;i++)if(sources[i].fd>=0){mount_source(sources[i].fd,root,sources[i].target,sources[i].directory,MOUNT_ATTR_RDONLY|MOUNT_ATTR_NOSUID|(sources[i].device?0:MOUNT_ATTR_NODEV));close(sources[i].fd);}
 char passwd[256],group[160];snprintf(passwd,sizeof(passwd),"observanda:x:%u:%u:Database:/observanda:/bin/sh\n",uid,gid);snprintf(group,sizeof(group),"observanda:x:%u:\n",gid);file_text_at(root,"etc/passwd",passwd,0644);file_text_at(root,"etc/group",group,0644);file_text_at(root,"etc/nsswitch.conf","passwd: files\ngroup: files\nhosts: files dns\n",0644);file_text_at(root,"etc/hosts","127.0.0.1 localhost\n::1 localhost\n",0644);
 checked(fchdir(root),"private root cwd");checked(chroot("."),"private root entry");checked(chdir("/observanda"),"database cwd");
 checked(mount("tmpfs","/tmp","tmpfs",MS_NOSUID|MS_NODEV|MS_NOEXEC,"mode=1777"),"private temporary files");checked(mkdir("/dev/shm",01777),"shared memory directory");checked(mount("tmpfs","/dev/shm","tmpfs",MS_NOSUID|MS_NODEV|MS_NOEXEC,"mode=1777"),"private shared memory");
 struct mount_attr readonly={.attr_set=MOUNT_ATTR_RDONLY};checked((int)syscall(SYS_mount_setattr,root,"",AT_EMPTY_PATH,&readonly,sizeof(readonly)),"read-only root");close(root);
 char target[512];if(!program||snprintf(target,sizeof(target),"/runtime/bin/%s",program)>=(int)sizeof(target)){errno=EINVAL;fail("program name");}if(!probe)argv[4]=target;
 /* These inherited descriptors must never expose the former host root. */
 checked((int)syscall(SYS_close_range,3,~0U,0),"descriptor closure");
 checked(clearenv(),"environment");checked(setenv("PATH","/runtime/bin:/bin",1),"environment");checked(setenv("HOME","/observanda",1),"environment");checked(setenv("TMPDIR","/tmp",1),"environment");checked(setenv("LANG","C",1),"environment");checked(setenv("LC_ALL","C",1),"environment");checked(setenv("TZ","UTC",1),"environment");checked(setenv("LD_LIBRARY_PATH","/runtime/lib",1),"environment");
 umask(0077);drop_privileges();syscall_filter();if(probe)return 0;execv(target,argv+4);fail("execute");
}
