// Filesystem syscalls absent from Node's fs API. All member operations take a
// single basename and an opened parent. There is no pathname fallback.
#define _GNU_SOURCE
#include <node_api.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

typedef struct { int fd; DIR *cursor; } Handle;
static napi_value fail(napi_env env,const char *code){napi_throw_error(env,code,code);return NULL;}
static napi_value system_error(napi_env env){
 const char *code="IO";
 switch(errno){case ENOENT:code="ENOENT";break;case EEXIST:code="EEXIST";break;case ENOSPC:case EDQUOT:code="ENOSPC";break;case ENOTEMPTY:code="ENOTEMPTY";break;case EBUSY:code="EBUSY";break;case EACCES:case EPERM:code="EACCES";break;case ELOOP:case ENOTDIR:case EINVAL:code="UNSAFE";break;}
 return fail(env,code);
}
static napi_value ok(napi_env env){napi_value value;napi_get_undefined(env,&value);return value;}
static void release(Handle *handle){if(handle->cursor){closedir(handle->cursor);handle->cursor=NULL;}if(handle->fd>=0){close(handle->fd);handle->fd=-1;}}
static void finalize(napi_env env,void *data,void *hint){(void)env;(void)hint;Handle *handle=data;release(handle);free(handle);}
static napi_value saved(napi_env env,int fd){
 Handle *handle=calloc(1,sizeof(*handle));if(!handle){close(fd);return fail(env,"IO");}handle->fd=fd;napi_value value;
 if(napi_create_external(env,handle,finalize,NULL,&value)!=napi_ok){release(handle);free(handle);return fail(env,"IO");}return value;
}
static Handle *handle(napi_env env,napi_value value){void *data=NULL;if(napi_get_value_external(env,value,&data)!=napi_ok||!data||((Handle *)data)->fd<0){fail(env,"IO");return NULL;}return data;}
static char *text(napi_env env,napi_value value,int member){
 size_t length=0;if(napi_get_value_string_utf8(env,value,NULL,0,&length)!=napi_ok||!length||length>1048576){fail(env,"UNSAFE");return NULL;}
 char *result=malloc(length+1);if(!result){fail(env,"IO");return NULL;}
 size_t copied;if(napi_get_value_string_utf8(env,value,result,length+1,&copied)!=napi_ok||copied!=length||strlen(result)!=length||(member&&(strchr(result,'/')||strchr(result,'\\')||!strcmp(result,".")||!strcmp(result,"..")))){free(result);fail(env,"UNSAFE");return NULL;}return result;
}
static int args(napi_env env,napi_callback_info info,size_t count,napi_value *values){size_t actual=count;if(napi_get_cb_info(env,info,&actual,values,NULL,NULL)!=napi_ok||actual!=count){fail(env,"INVALID");return 0;}return 1;}
static int directory_fd(napi_env env,Handle *value){struct stat st;if(fstat(value->fd,&st)<0){system_error(env);return 0;}if(!S_ISDIR(st.st_mode)){fail(env,"UNSAFE");return 0;}return 1;}
static napi_value root(napi_env env,napi_callback_info info){
 napi_value values[1];if(!args(env,info,1,values))return NULL;char *name=text(env,values[0],0);if(!name)return NULL;
 if(name[0]!='/'){free(name);return fail(env,"UNSAFE");}int current=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(current<0){free(name);return system_error(env);}
 char *state=NULL;for(char *part=strtok_r(name,"/",&state);part;part=strtok_r(NULL,"/",&state)){
  if(!strcmp(part,".")||!strcmp(part,"..")){close(current);free(name);return fail(env,"UNSAFE");}
  int next=openat(current,part,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);int error=errno;close(current);current=next;if(current<0){free(name);errno=error;return system_error(env);}
 }free(name);return saved(env,current);
}
static napi_value child(napi_env env,napi_callback_info info){
 napi_value values[3];if(!args(env,info,3,values))return NULL;Handle *parent=handle(env,values[0]);if(!parent||!directory_fd(env,parent))return NULL;char *name=text(env,values[1],1);if(!name)return NULL;
 int32_t mode;if(napi_get_value_int32(env,values[2],&mode)!=napi_ok||mode<0||mode>5){free(name);return fail(env,"INVALID");}
 // 0 existing directory, 1 create directory, 2 read file, 3 update file,
 // 4 exclusive new file, 5 exclusive new directory. Nonblocking prevents a
 // substituted FIFO from hanging. Never claim an existing directory as new.
 int folder=mode<2||mode==5;
 if(mode==1||mode==5){int created=mkdirat(parent->fd,name,0700);if(created<0&&(errno!=EEXIST||mode==5)){free(name);return system_error(env);}if(created==0&&fsync(parent->fd)<0){free(name);return system_error(env);}}
 int flags=O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK|(folder?O_RDONLY|O_DIRECTORY:mode==2?O_RDONLY:O_RDWR);if(mode==4)flags|=O_CREAT|O_EXCL;
 int fd=openat(parent->fd,name,flags,0600);free(name);if(fd<0)return system_error(env);struct stat st;
 if(fstat(fd,&st)<0){int error=errno;close(fd);errno=error;return system_error(env);}if(folder?!S_ISDIR(st.st_mode):!S_ISREG(st.st_mode)){close(fd);return fail(env,"UNSAFE");}
 if(mode==5&&(st.st_uid!=geteuid()||(st.st_mode&0077))){close(fd);return fail(env,"UNSAFE");}
 if(mode==4&&fsync(parent->fd)<0){int error=errno;close(fd);errno=error;return system_error(env);}
 return saved(env,fd);
}
static napi_value lease(napi_env env,napi_callback_info info){
 napi_value values[2];if(!args(env,info,2,values))return NULL;Handle *parent=handle(env,values[0]);if(!parent||!directory_fd(env,parent))return NULL;char *name=text(env,values[1],1);if(!name)return NULL;
 int fd=openat(parent->fd,name,O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK,0600);free(name);if(fd<0)return system_error(env);struct stat st;
 if(fstat(fd,&st)<0){int error=errno;close(fd);errno=error;return system_error(env);}if(!S_ISREG(st.st_mode)||st.st_nlink!=1){close(fd);return fail(env,"UNSAFE");}
 if(flock(fd,LOCK_EX|LOCK_NB)<0){int error=errno;close(fd);if(error==EWOULDBLOCK||error==EAGAIN)return fail(env,"EBUSY");errno=error;return system_error(env);}
 return saved(env,fd);
}
static napi_value descriptor(napi_env env,napi_callback_info info){napi_value values[1],result;if(!args(env,info,1,values))return NULL;Handle *file=handle(env,values[0]);if(!file)return NULL;napi_create_int32(env,file->fd,&result);return result;}
static napi_value close_handle(napi_env env,napi_callback_info info){napi_value values[1];if(!args(env,info,1,values))return NULL;Handle *file=handle(env,values[0]);if(!file)return NULL;release(file);return ok(env);}
static napi_value entries(napi_env env,napi_callback_info info){
 napi_value values[2],result,rows,done;if(!args(env,info,2,values))return NULL;Handle *parent=handle(env,values[0]);if(!parent||!directory_fd(env,parent))return NULL;bool restart=false;if(napi_get_value_bool(env,values[1],&restart)!=napi_ok)return fail(env,"INVALID");
 if(restart&&parent->cursor){closedir(parent->cursor);parent->cursor=NULL;}
 if(!parent->cursor){int fd=openat(parent->fd,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return system_error(env);parent->cursor=fdopendir(fd);if(!parent->cursor){int error=errno;close(fd);errno=error;return system_error(env);}}
 napi_create_array(env,&rows);bool finished=false;
 for(unsigned i=0;i<256;){errno=0;struct dirent *entry=readdir(parent->cursor);if(!entry){if(errno)return system_error(env);finished=true;break;}if(!strcmp(entry->d_name,".")||!strcmp(entry->d_name,".."))continue;
  struct stat st;if(fstatat(parent->fd,entry->d_name,&st,AT_SYMLINK_NOFOLLOW)<0)return system_error(env);if(!S_ISREG(st.st_mode)&&!S_ISDIR(st.st_mode))return fail(env,"UNSAFE");
  napi_value row,name,folder;napi_create_object(env,&row);napi_create_string_utf8(env,entry->d_name,NAPI_AUTO_LENGTH,&name);napi_get_boolean(env,S_ISDIR(st.st_mode),&folder);napi_set_named_property(env,row,"name",name);napi_set_named_property(env,row,"directory",folder);napi_set_element(env,rows,i++,row);
 }napi_create_object(env,&result);napi_get_boolean(env,finished,&done);napi_set_named_property(env,result,"entries",rows);napi_set_named_property(env,result,"done",done);return result;
}
static napi_value mutate(napi_env env,napi_callback_info info){
 napi_value values[6];if(!args(env,info,6,values))return NULL;Handle *parent=handle(env,values[0]),*target=handle(env,values[2]);if(!parent||!target||!directory_fd(env,parent)||!directory_fd(env,target))return NULL;
 char *name=text(env,values[1],1);if(!name)return NULL;char *next=text(env,values[3],1);if(!next){free(name);return NULL;}
 int32_t operation;bool folder;if(napi_get_value_int32(env,values[4],&operation)!=napi_ok||napi_get_value_bool(env,values[5],&folder)!=napi_ok){free(name);free(next);return fail(env,"INVALID");}int status=-1;
 if(operation==0){
#ifdef __APPLE__
  status=renameatx_np(parent->fd,name,target->fd,next,RENAME_EXCL);
#elif defined(__linux__)
  status=renameat2(parent->fd,name,target->fd,next,RENAME_NOREPLACE);
#else
#error Unsupported filesystem target
#endif
 }else if(operation==1&&!folder)status=linkat(parent->fd,name,target->fd,next,0);
 else if(operation==2)status=unlinkat(parent->fd,name,folder?AT_REMOVEDIR:0);
 else if(operation==3&&!folder)status=renameat(parent->fd,name,target->fd,next);
 else{free(name);free(next);return fail(env,"INVALID");}
 int error=errno;free(name);free(next);if(status<0){errno=error;return system_error(env);}
 if(fsync(parent->fd)<0||(target!=parent&&fsync(target->fd)<0))return system_error(env);
 return ok(env);
}
static napi_value initialize(napi_env env,napi_value exports){
 napi_property_descriptor methods[]={
  {"root",NULL,root,NULL,NULL,NULL,napi_default,NULL},{"child",NULL,child,NULL,NULL,NULL,napi_default,NULL},
  {"lease",NULL,lease,NULL,NULL,NULL,napi_default,NULL},
  {"fd",NULL,descriptor,NULL,NULL,NULL,napi_default,NULL},{"close",NULL,close_handle,NULL,NULL,NULL,napi_default,NULL},
  {"entries",NULL,entries,NULL,NULL,NULL,napi_default,NULL},{"mutate",NULL,mutate,NULL,NULL,NULL,napi_default,NULL}
 };napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
