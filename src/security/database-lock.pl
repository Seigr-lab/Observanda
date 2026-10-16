use strict;
use warnings;
use Fcntl qw(:flock O_RDWR O_CREAT O_NOFOLLOW);
umask 0077;
sysopen(my $lock, $ARGV[0], O_RDWR | O_CREAT | O_NOFOLLOW, 0600) or exit 74;
flock($lock, LOCK_EX | LOCK_NB) or exit 73;
$| = 1;
print "locked\n";
while (sysread(STDIN, my $byte, 1)) { }
