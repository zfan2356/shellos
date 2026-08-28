$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJsonPath = Join-Path $root "package.json"
$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "vsix-stage"
$extensionDir = Join-Path $stage "extension"
$vsixName = "$($packageJson.name)-$($packageJson.version).vsix"
$zipPath = Join-Path $dist "$vsixName.zip"
$vsixPath = Join-Path $dist $vsixName

function Assert-ChildPath {
  param(
    [string] $Child,
    [string] $Parent
  )

  $parentFull = [System.IO.Path]::GetFullPath($Parent)
  $childFull = [System.IO.Path]::GetFullPath($Child)

  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside package directory: $childFull"
  }
}

function Escape-Xml {
  param([string] $Value)
  return [System.Security.SecurityElement]::Escape($Value)
}

New-Item -ItemType Directory -Force $dist | Out-Null
Assert-ChildPath -Child $stage -Parent $dist

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}

New-Item -ItemType Directory -Force $extensionDir | Out-Null
Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $extensionDir
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $extensionDir
Copy-Item -LiteralPath (Join-Path $root "src") -Destination $extensionDir -Recurse
Copy-Item -LiteralPath (Join-Path $root "resources") -Destination $extensionDir -Recurse

$contentTypes = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
"@

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="$(Escape-Xml $packageJson.name)" Version="$(Escape-Xml $packageJson.version)" Publisher="$(Escape-Xml $packageJson.publisher)" />
    <DisplayName>$(Escape-Xml $packageJson.displayName)</DisplayName>
    <Description xml:space="preserve">$(Escape-Xml $packageJson.description)</Description>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$(Escape-Xml $packageJson.engines.vscode)" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Code.Content" Path="extension" />
  </Assets>
</PackageManifest>
"@

Set-Content -LiteralPath (Join-Path $stage "[Content_Types].xml") -Value $contentTypes -Encoding UTF8
Set-Content -LiteralPath (Join-Path $stage "extension.vsixmanifest") -Value $manifest -Encoding UTF8

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path $vsixPath) {
  Remove-Item -LiteralPath $vsixPath -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force
Move-Item -LiteralPath $zipPath -Destination $vsixPath -Force

Write-Output $vsixPath
