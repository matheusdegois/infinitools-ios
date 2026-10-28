import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const objects = {};
const id = key => crypto.createHash('sha1').update(key).digest('hex').slice(0,24).toUpperCase();
const add = (key, isa, fields) => { const value = id(key); objects[value] = {isa, ...fields}; return value; };
const ref = (file, type) => add('file:' + file, 'PBXFileReference', {lastKnownFileType: type, path: file, sourceTree: '<group>'});
const build = (file, target) => add('build:' + file + ':' + target, 'PBXBuildFile', {fileRef: file});
const walk = dir => fs.readdirSync(path.join(root,dir), {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(dir+'/'+e.name) : [dir+'/'+e.name]);
const appSources = walk('Infinitools').filter(f=>f.endsWith('.swift')).concat(['Shared/IncomingFiles.swift']);
const extensionSources = ['ShareExtension/ShareViewController.swift','Shared/IncomingFiles.swift'];
const appResources = [['Infinitools/Resources/WebContent','folder'],['Infinitools/Resources/Assets.xcassets','folder.assetcatalog'],['Infinitools/PrivacyInfo.xcprivacy','text.xml']];
const sourceRefs = new Map([...new Set([...appSources,...extensionSources,'Tests/iOS/WebEngineTests.swift','Tests/UI/InfinitoolsUITests.swift'])].map(f=>[f,ref(f,'sourcecode.swift')]));
const resourceRefs = appResources.map(([f,t])=>ref(f,t));
const extPrivacy = ref('ShareExtension/PrivacyInfo.xcprivacy','text.xml');
const products = {};
for (const [name,type] of [['Infinitools','wrapper.application'],['InfinitoolsShare','wrapper.app-extension'],['InfinitoolsTests','wrapper.cfbundle'],['InfinitoolsUITests','wrapper.cfbundle']]) {
  products[name] = add('product:'+name, 'PBXFileReference', {explicitFileType:type, path:name+(name==='Infinitools'?'.app':name==='InfinitoolsShare'?'.appex':'.xctest'), sourceTree:'BUILT_PRODUCTS_DIR'});
}
const group = add('main-group','PBXGroup',{children:[...sourceRefs.values(),...resourceRefs,extPrivacy,ref('Infinitools/Info.plist','text.plist.xml'),ref('ShareExtension/Info.plist','text.plist.xml'),ref('Infinitools/Infinitools.entitlements','text.plist.entitlements'),ref('ShareExtension/Share.entitlements','text.plist.entitlements'),id('products')], sourceTree:'<group>'});
add('products','PBXGroup',{children:Object.values(products),name:'Products',sourceTree:'<group>'});
const configurationList = (key, common, extra = {}) => {
  const ids = ['Debug','Release'].map(name=>add('config:'+key+name,'XCBuildConfiguration',{buildSettings:{...common,...(name==='Debug'?{SWIFT_OPTIMIZATION_LEVEL:'-Onone',SWIFT_ACTIVE_COMPILATION_CONDITIONS:'DEBUG',DEBUG_INFORMATION_FORMAT:'dwarf',ENABLE_TESTABILITY:'YES'}:{SWIFT_OPTIMIZATION_LEVEL:'-O',DEBUG_INFORMATION_FORMAT:'dwarf-with-dsym',VALIDATE_PRODUCT:'YES'}),...extra},name}));
  return add('configs:'+key,'XCConfigurationList',{buildConfigurations:ids,defaultConfigurationIsVisible:0,defaultConfigurationName:'Release'});
};
const projectConfig=configurationList('project',{CLANG_ENABLE_MODULES:'YES',SWIFT_VERSION:'5.0',IPHONEOS_DEPLOYMENT_TARGET:'17.0',SDKROOT:'iphoneos',TARGETED_DEVICE_FAMILY:'1,2',CODE_SIGN_STYLE:'Automatic',DEVELOPMENT_TEAM:'',GCC_C_LANGUAGE_STANDARD:'gnu17',CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER:'YES',SWIFT_STRICT_CONCURRENCY:'targeted'});
const dependency = (target, dependent) => {
  const proxy=add('proxy:'+dependent+target,'PBXContainerItemProxy',{containerPortal:id('project'),proxyType:1,remoteGlobalIDString:id('target:'+target),remoteInfo:target});
  return add('dependency:'+dependent+target,'PBXTargetDependency',{target:id('target:'+target),targetProxy:proxy});
};
for (const name of Object.keys(products)) {
  const app=name==='Infinitools', extension=name==='InfinitoolsShare', ui=name==='InfinitoolsUITests';
  const files=app?appSources:extension?extensionSources:ui?['Tests/UI/InfinitoolsUITests.swift']:['Tests/iOS/WebEngineTests.swift'];
  const sources=add('sources:'+name,'PBXSourcesBuildPhase',{buildActionMask:2147483647,files:files.map(f=>build(sourceRefs.get(f),name)),runOnlyForDeploymentPostprocessing:0});
  const resources=add('resources:'+name,'PBXResourcesBuildPhase',{buildActionMask:2147483647,files:(app?resourceRefs:extension?[extPrivacy]:[]).map(f=>build(f,name)),runOnlyForDeploymentPostprocessing:0});
  const frameworks=add('frameworks:'+name,'PBXFrameworksBuildPhase',{buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0});
  const settings={PRODUCT_NAME:'$(TARGET_NAME)',PRODUCT_BUNDLE_IDENTIFIER:app?'br.com.infinitools.ios':extension?'br.com.infinitools.ios.share':ui?'br.com.infinitools.ios.uitests':'br.com.infinitools.ios.tests',GENERATE_INFOPLIST_FILE:app||extension?'NO':'YES',CURRENT_PROJECT_VERSION:'1',MARKETING_VERSION:'1.0.0',LD_RUNPATH_SEARCH_PATHS:['$(inherited)','@executable_path/Frameworks']};
  if(app||extension){ settings.INFOPLIST_FILE=app?'Infinitools/Info.plist':'ShareExtension/Info.plist';settings.CODE_SIGN_ENTITLEMENTS=app?'Infinitools/Infinitools.entitlements':'ShareExtension/Share.entitlements'; }
  if(app){settings.ASSETCATALOG_COMPILER_APPICON_NAME='AppIcon';settings.ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME='AccentColor';}
  if(extension){settings.APPLICATION_EXTENSION_API_ONLY='YES';settings.SKIP_INSTALL='YES';settings.LD_RUNPATH_SEARCH_PATHS.push('@executable_path/../../Frameworks');}
  if(!app&&!extension){settings.TEST_TARGET_NAME='Infinitools'; if(!ui){settings.TEST_HOST='$(BUILT_PRODUCTS_DIR)/Infinitools.app/Infinitools';settings.BUNDLE_LOADER='$(TEST_HOST)';}}
  const phases=[sources,frameworks,resources];
  if(app){const embed=add('embed-extension','PBXBuildFile',{fileRef:products.InfinitoolsShare,settings:{ATTRIBUTES:['RemoveHeadersOnCopy']}});phases.push(add('embed-phase','PBXCopyFilesBuildPhase',{buildActionMask:2147483647,dstPath:'',dstSubfolderSpec:13,files:[embed],name:'Embed App Extensions',runOnlyForDeploymentPostprocessing:0}));}
  add('target:'+name,'PBXNativeTarget',{buildConfigurationList:configurationList(name,settings),buildPhases:phases,buildRules:[],dependencies:app?[dependency('InfinitoolsShare',name)]:extension?[]:[dependency('Infinitools',name)],name,productName:name,productReference:products[name],productType:app?'com.apple.product-type.application':extension?'com.apple.product-type.app-extension':ui?'com.apple.product-type.bundle.ui-testing':'com.apple.product-type.bundle.unit-test'});
}
add('project','PBXProject',{attributes:{BuildIndependentTargetsInParallel:'YES',LastSwiftUpdateCheck:'1600',LastUpgradeCheck:'1600',TargetAttributes:{[id('target:Infinitools')]:{CreatedOnToolsVersion:'16.0',SystemCapabilities:{'com.apple.ApplicationGroups.iOS':{enabled:1}}},[id('target:InfinitoolsShare')]:{CreatedOnToolsVersion:'16.0',SystemCapabilities:{'com.apple.ApplicationGroups.iOS':{enabled:1}}}}},buildConfigurationList:projectConfig,compatibilityVersion:'Xcode 14.0',developmentRegion:'pt-BR',hasScannedForEncodings:0,knownRegions:['pt-BR','en','Base'],mainGroup:group,productRefGroup:id('products'),projectDirPath:'',projectRoot:'',targets:Object.keys(products).map(n=>id('target:'+n))});
function encode(value,level=0){
  if(Array.isArray(value))return '(\n'+value.map(v=>'\t'.repeat(level+1)+encode(v,level+1)+',').join('\n')+'\n'+'\t'.repeat(level)+')';
  if(value&&typeof value==='object')return '{\n'+Object.entries(value).map(([k,v])=>'\t'.repeat(level+1)+(/^[A-Za-z0-9_]+$/.test(k)?k:JSON.stringify(k))+' = '+encode(v,level+1)+';').join('\n')+'\n'+'\t'.repeat(level)+'}';
  return typeof value==='number'?String(value):/^[A-Za-z0-9_]+$/.test(value)?value:JSON.stringify(value);
}
const project=path.join(root,'Infinitools.xcodeproj');fs.mkdirSync(project,{recursive:true});
fs.writeFileSync(path.join(project,'project.pbxproj'),'// !$*UTF8*$!\n'+encode({archiveVersion:1,classes:{},objectVersion:56,objects,rootObject:id('project')})+'\n');
const schemeDir=path.join(project,'xcshareddata','xcschemes');fs.mkdirSync(schemeDir,{recursive:true});
const target=n=>`<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id('target:'+n)}" BuildableName="${n}${n==='Infinitools'?'.app':'.xctest'}" BlueprintName="${n}" ReferencedContainer="container:Infinitools.xcodeproj"/>`;
fs.writeFileSync(path.join(schemeDir,'Infinitools.xcscheme'),`<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${target('Infinitools')}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO" parallelizable="NO">${target('InfinitoolsTests')}</TestableReference><TestableReference skipped="NO" parallelizable="NO">${target('InfinitoolsUITests')}</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${target('Infinitools')}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugServiceExtension="internal"><BuildableProductRunnable runnableDebuggingMode="0">${target('Infinitools')}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>\n`);
console.log(`${appSources.length} fontes no app, extensão de compartilhamento e dois targets de teste.`);
const schemeFile=path.join(schemeDir,'Infinitools.xcscheme');
fs.writeFileSync(schemeFile,fs.readFileSync(schemeFile,'utf8').replace('</Testables>','</Testables><EnvironmentVariables><EnvironmentVariable key="INFINITOOLS_UNIT_TEST_HOST" value="1" isEnabled="YES"/></EnvironmentVariables>'));
