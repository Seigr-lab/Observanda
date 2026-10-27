// Official pinned binary releases. Build-time downloads only; runtime never
// invokes a package manager or retrieves a validator from the network.
export const PDF_VALIDATOR_VERSION='1.30.3';
export const PDF_VALIDATOR_SHA256='4c8acbaeb16405456c8d6d76deac8cf40d94618cb4e33aedf44e51ee1b68be91';
export const pdfValidatorArtifact={name:'verapdf-cli-1.30.3.jar',url:'https://repo.maven.apache.org/maven2/org/verapdf/apps/cli/1.30.3/cli-1.30.3.jar',sha256:PDF_VALIDATOR_SHA256,bytes:16057132};
export const pdfJavaSources={
 '25.0.5+8':'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jdk-sources_25.0.5_8.tar.gz',
 '21.0.12.1+1':'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz'
};
export const pdfJavaArtifacts={
 "win32-x64": {
  "version": "25.0.5+8",
  "name": "OpenJDK25U-jre_x64_windows_hotspot_25.0.5_8.zip",
  "url": "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_x64_windows_hotspot_25.0.5_8.zip",
  "sha256": "da78d54a2fcdbba1e92d5e3f07dd30236f96297891c4a21a781c3f38f5c0beae",
  "bytes": 58589419
 },
 "darwin-x64": {
  "version": "21.0.12.1+1",
  "name": "OpenJDK21U-jre_x64_mac_hotspot_21.0.12.1_1.tar.gz",
  "url": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_mac_hotspot_21.0.12.1_1.tar.gz",
  "sha256": "6717ec641fd9ce0bb209ca083ee23b42202ac68cb6fcc5753496e0e4a0f41989",
  "bytes": 42131876
 },
 "darwin-arm64": {
  "version": "21.0.12.1+1",
  "name": "OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz",
  "url": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz",
  "sha256": "dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84",
  "bytes": 48144965
 },
 "linux-x64": {
  "version": "25.0.5+8",
  "name": "OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz",
  "url": "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz",
  "sha256": "6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6",
  "bytes": 61736206
 },
 "linux-arm64": {
  "version": "21.0.12.1+1",
  "name": "OpenJDK21U-jre_aarch64_linux_hotspot_21.0.12.1_1.tar.gz",
  "url": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.12.1_1.tar.gz",
  "sha256": "14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2",
  "bytes": 51149460
 }
};

export const pdfValidatorLicense={name:'verapdf-1.30.3-LICENSE.MPL',url:'https://raw.githubusercontent.com/veraPDF/veraPDF-apps/v1.30.3/LICENSE.MPL',sha256:'af175b9d96ee93c21a036152e1b905b0b95304d4ae8c2c921c7609100ba8df7e'};
