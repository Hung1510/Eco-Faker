while ($true) {my-eco-gen serve --chaos --chaos-error-rate 0.25 --chaos-rate-limit-rate 0.25
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:4000/api/orders" -UseBasicParsing
        $code = $resp.StatusCode
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
    }
    $color = switch ($code) { 200 { "Green" }; 429 { "Yellow" }; default { "Red" } }
    Write-Host $code -ForegroundColor $color
    Start-Sleep -Milliseconds 300
}