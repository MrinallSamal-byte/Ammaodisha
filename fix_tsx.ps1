# Read file as bytes to preserve encoding exactly
$filePath = 'c:\AmmaOdisha\Garbage_BBSR\src\components\PublicApp.tsx'
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$content = [System.Text.Encoding]::UTF8.GetString($bytes)

$changeCount = 0

# 1. Stats strip: add Resolved stat between Active and Reports, rename Reports to Total
$search1 = '<Stat label="Active" value={unresolved.length} tone="red" />' + "`r`n" + '        <Stat label="Reports" value={reports.length} tone="gray" />'
$replace1 = '<Stat label="Active" value={unresolved.length} tone="red" />' + "`r`n" + '        <Stat label="Resolved" value={resolved.length} tone="green" />' + "`r`n" + '        <Stat label="Total" value={reports.length} tone="gray" />'

if ($content.Contains($search1)) {
    $content = $content.Replace($search1, $replace1)
    $changeCount++
    Write-Host "Applied change 1: Stats strip"
} else {
    Write-Host "WARNING: Could not find stats strip pattern"
}

# 2. IntroOverlay: add hero image before logo
$search2 = '<img src="/logo.png" alt="" />' + "`r`n" + '      <p className="eyebrow">Bhubaneswar (BMC)</p>' + "`r`n" + '      <h2>Tap a red dot to see the report.</h2>'
$replace2 = '<img className="intro-hero-image" src="/garbage-hero.png" alt="Garbage on streets of Bhubaneswar" />' + "`r`n" + '      <div className="intro-card-body">' + "`r`n" + '      <img src="/logo.png" alt="" />' + "`r`n" + '      <p className="eyebrow">Bhubaneswar (BMC)</p>' + "`r`n" + '      <h2>Report garbage. Hold your ward accountable.</h2>'

if ($content.Contains($search2)) {
    $content = $content.Replace($search2, $replace2)
    $changeCount++
    Write-Host "Applied change 2: Intro hero image"
} else {
    Write-Host "WARNING: Could not find intro image pattern"
}

# 3. IntroOverlay: update description text
$search3 = '<p>Open a marker, check the ward and BMC actions, or start a new report.</p>'
$replace3 = '<p>Every garbage dump is mapped, photographed, and linked to the responsible ward, MLA, and MP.</p>'

if ($content.Contains($search3)) {
    $content = $content.Replace($search3, $replace3)
    $changeCount++
    Write-Host "Applied change 3: Intro description"
} else {
    Write-Host "WARNING: Could not find intro description pattern"
}

# 4. IntroOverlay: update small text
$search4 = '<small>Every report stays linked to a ward, MLA, and MP until it is cleaned.</small>'
$replace4 = '<small>Tap a red dot on the map to see a report, or start a new one.</small>'

if ($content.Contains($search4)) {
    $content = $content.Replace($search4, $replace4)
    $changeCount++
    Write-Host "Applied change 4: Intro small text"
} else {
    Write-Host "WARNING: Could not find intro small text pattern"
}

# 5. IntroOverlay: update button text and close card-body div
$search5 = 'Start using map' + "`n" + '      </button>'
$replace5 = 'Start exploring the map' + "`n" + '      </button>' + "`r`n" + '      </div>'

if ($content.Contains($search5)) {
    $content = $content.Replace($search5, $replace5)
    $changeCount++
    Write-Host "Applied change 5: Intro button and div"
} else {
    Write-Host "WARNING: Could not find intro button pattern"
}

# 6. AboutSheet: add hero image after close button
$search6 = '        </button>' + "`r`n" + '        <h2>Why Amma Odisha?</h2>' + "`r`n" + '        <p className="eyebrow">AMMA ODISHA</p>'
$replace6 = '        </button>' + "`r`n" + '        <img className="about-hero-image" src="/garbage-about.png" alt="Illegal garbage dumping in Bhubaneswar" />' + "`r`n" + '        <h2>Why Amma Odisha?</h2>' + "`r`n" + '        <p className="eyebrow">AMMA ODISHA</p>'

if ($content.Contains($search6)) {
    $content = $content.Replace($search6, $replace6)
    $changeCount++
    Write-Host "Applied change 6: About hero image"
} else {
    Write-Host "WARNING: Could not find about sheet pattern"
}

# Write back preserving encoding
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($filePath, $content, $utf8NoBom)

Write-Host "`nTotal changes applied: $changeCount / 6"
