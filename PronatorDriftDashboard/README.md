# Pronator Drift — R Shiny Analytics & Education Dashboard

An interactive [Shiny](https://shiny.posit.co/) dashboard that reads the live
Pronator Drift Google Sheet and turns the aggregated screening data into an
analytics **and** teaching tool. It is designed to look good, read clearly, and
explain the science as you explore.

## What it shows

| Tab | Purpose |
|---|---|
| **Overview** | Headline KPIs, classification mix, timeline, and a plain-language primer on the test and the three signs it measures. |
| **Participants** | Cohort make-up: age distribution, gender mix, device, and drift-by-age. |
| **Drift & Pronation** | The two core signs, left vs right, with prototype reference bands and the "diagnostic quadrant" (drift × pronation). |
| **Left–Right Asymmetry** | The clinically meaningful signal — how the two arms differ — with a paired comparison and significance test. |
| **Tremor & Stability** | Oscillation amplitude, the 8–12 Hz dominant-frequency band, stability, and finger metrics. |
| **Relationships** | A scatter explorer (any metric vs any metric, colour-coded) plus a correlation heatmap. |
| **Quality & Reliability** | Valid-frame %, effective FPS, and whether quality relates to the measured drift. |
| **Data Explorer** | The full live table + CSV download + a plain-language data dictionary. |

Every tab has an "About this view" panel written in non-diagnostic, educational
language, and each metric is explained in the data dictionary.

## 1. Point it at your sheet

The sheet must be shared so the CSV endpoint can be read:

1. Open your Pronator Drift results sheet.
2. **Share → General access → Anyone with the link → Viewer.**
3. Copy the Sheet ID (the token between `/d/` and `/edit` in the URL).
4. In `app.R`, set:

   ```r
   SHEET_ID  <- "your-sheet-id-here"
   SHEET_TAB <- "Results"   # the tab name written by the Apps Script
   ```

The column names in `app.R` (`COLS`) match the header row produced by the Apps
Script in the main project README §14. If you rename headers there, update
`COLS` here to match. Until a valid sheet is configured, the app renders a
built-in **demo dataset** so you can preview the layout.

## 2. Run locally

```r
install.packages(c("shiny","bslib","ggplot2","dplyr","tidyr","DT",
                   "plotly","scales","lubridate","stringr"))
shiny::runApp("PronatorDriftDashboard")
```

`plotly`, `lubridate`, and `stringr` are optional — the app soft-loads them and
falls back to static ggplot charts if they are missing.

## 3. Deploy to shinyapps.io

```r
install.packages("rsconnect")

# One-time: paste the token/secret from your shinyapps.io account
# (Account → Tokens → Show → Copy to clipboard).
rsconnect::setAccountInfo(name   = "YOUR_ACCOUNT",
                          token  = "YOUR_TOKEN",
                          secret = "YOUR_SECRET")

rsconnect::deployApp(
  appDir  = "PronatorDriftDashboard",
  appName = "pronator-drift"
)
```

After deploy, your app is live at
`https://YOUR_ACCOUNT.shinyapps.io/pronator-drift/`.

Notes:
- The free shinyapps.io tier is fine for this app. It re-polls the sheet every
  2 minutes (`AUTO_REFRESH_MS`), so new assessments appear automatically.
- Because the sheet is read as a public CSV, no Google credentials are stored on
  shinyapps.io. If you prefer authenticated access instead, swap the
  `utils::read.csv(sheet_csv_url(...))` call in `load_data()` for
  `googlesheets4::read_sheet()` and configure a service account.

## Privacy

The dashboard displays participant names/ages exactly as they appear in your
sheet. Deploy it behind shinyapps.io authentication (Settings → add authorised
users) if the data should not be public, and only collect data where the intake
declaration was accepted.
