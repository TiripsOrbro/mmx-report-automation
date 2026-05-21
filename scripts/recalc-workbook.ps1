param(
    [string]$Path = (Join-Path $PSScriptRoot '..\data\workbooks\Build To JS.xlsx')
)

$Path = (Resolve-Path $Path).Path
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    $wb = $excel.Workbooks.Open($Path)
    $excel.CalculateFullRebuild()
    $wb.Save()
    $wb.Close($false)
    Write-Output "Recalculated and saved: $Path"
} finally {
    $excel.Quit()
    [void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel)
}
