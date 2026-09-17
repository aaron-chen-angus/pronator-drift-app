# ==============================================================================
# Pronator Drift — R Shiny Analytics & Education Dashboard
# ------------------------------------------------------------------------------
# Reads the live Pronator Drift Google Sheet (published "Anyone with link can
# view") and turns the aggregated screening data into an interactive, educational
# analytics experience.
#
# The app is organised so a first-time viewer can LEARN what the pronator drift
# test measures while an analyst can EXPLORE the data in depth:
#
#   0. Overview        – headline KPIs, cohort snapshot, classification mix,
#                        and a plain-language primer on the test + each metric.
#   1. Participant     – who was tested (age/gender distributions, timeline).
#   2. Drift & Pronation – the two core signs, left vs right, with clinical
#                        interpretation and prototype reference bands.
#   3. Left–Right Asymmetry – the clinically meaningful signal: asymmetry between
#                        arms, per participant, with a paired comparison.
#   4. Tremor & Stability – oscillation amplitude, dominant frequency (8-12 Hz
#                        physiological band), stability and finger metrics.
#   5. Relationships   – scatter explorer (any metric vs any metric) + a
#                        correlation heatmap, with guided reading notes.
#   6. Quality & Reliability – how trustworthy each row is (valid-frame %, FPS).
#   7. Data Explorer   – full filterable table + CSV download + data dictionary.
#
# DESIGN NOTES
#   * Aesthetics: a cohesive dark "clinical navy + cyan" theme (matching the web
#     app), custom ggplot theme, curated palettes, KPI value boxes, and generous
#     explanatory copy. Plotly is used where interactivity adds insight and
#     falls back to static ggplot if plotly is unavailable.
#   * Every tab carries an "About this view" panel written in non-diagnostic,
#     educational language, and every metric has a tooltip/definition sourced
#     from the app's data dictionary (README §5).
#   * The column names below match the Google Sheet header row created by the
#     Apps Script in README §14. If you rename headers there, update COLS here.
#
# RUN LOCALLY
#   install.packages(c("shiny","bslib","ggplot2","dplyr","tidyr","DT",
#                      "plotly","scales","lubridate","stringr"))
#   shiny::runApp("PronatorDriftDashboard")   # (folder containing this app.R)
#
# DEPLOY TO shinyapps.io
#   install.packages("rsconnect")
#   rsconnect::setAccountInfo(name=..., token=..., secret=...)   # from your account
#   rsconnect::deployApp("PronatorDriftDashboard", appName = "pronator-drift")
# ==============================================================================

# ---- Packages (soft-load optional ones) --------------------------------------
library(shiny)
library(bslib)
library(ggplot2)
library(dplyr)
library(tidyr)
library(DT)
library(scales)

have_plotly    <- requireNamespace("plotly",    quietly = TRUE)
have_lubridate <- requireNamespace("lubridate", quietly = TRUE)
have_stringr   <- requireNamespace("stringr",   quietly = TRUE)

# ---- Data source -------------------------------------------------------------
# Paste your published Sheet ID here (the token between /d/ and /edit in the URL).
# The sheet must be shared as "Anyone with the link can view" for this CSV read.
SHEET_ID  <- "PASTE_YOUR_SHEET_ID_HERE"
SHEET_TAB <- "Results"
# gviz CSV endpoint returns the sheet's header row as column names.
sheet_csv_url <- function(id, tab) {
  paste0("https://docs.google.com/spreadsheets/d/", id,
         "/gviz/tq?tqx=out:csv&sheet=", utils::URLencode(tab))
}
AUTO_REFRESH_MS <- 120000  # re-poll every 2 minutes

# ---- Colour system -----------------------------------------------------------
PAL <- list(
  bg      = "#0b1020",  # deep navy
  surface = "#121a30",
  ink     = "#e8f6fb",
  muted   = "#9fb3c8",
  cyan    = "#22d3ee",
  teal    = "#2dd4bf",
  left    = "#38bdf8",  # left arm
  right   = "#f472b6",  # right arm
  warn    = "#fbbf24",
  bad     = "#fb7185",
  good    = "#34d399",
  grid    = "#26324d"
)
CLASS_COLORS <- c(
  "no_significant_drift"            = PAL$good,
  "possible_left_pronator_drift"    = PAL$left,
  "possible_right_pronator_drift"   = PAL$right,
  "possible_bilateral_drift"        = PAL$warn,
  "drift_without_clear_pronation"   = PAL$teal,
  "possible_pronation_without_drift"= PAL$cyan,
  "unable_to_assess"                = PAL$muted
)

# ---- Column names in the sheet (must match README §14 HEADERS_) --------------
COLS <- list(
  name       = "Participant Name",
  gender     = "Gender",
  age        = "Age",
  declaration= "Declaration Accepted",
  testTime   = "Test Date/Time",
  exportedAt = "Exported At",
  assessId   = "Assessment ID",
  startedAt  = "Started At",
  completedAt= "Completed At",
  duration   = "Duration (s)",
  device     = "Device",
  classification = "Overall Classification",
  assessedArm= "Assessed Arm",
  quality    = "Quality",
  validPct   = "Valid Frame %",
  poseConf   = "Avg Pose Confidence",
  camStab    = "Camera Stability",
  fps        = "Effective FPS",
  L_maxDrift = "Left Max Drift (norm)",
  L_onset    = "Left Drift Onset (s)",
  L_dur      = "Left Drift Duration (ms)",
  L_sustained= "Left Sustained Drift",
  L_pron     = "Left Pronation (deg)",
  L_possPron = "Left Possible Pronation",
  L_elbowFlex= "Left Elbow Flexion Change (deg)",
  L_armTorso = "Left Arm-to-Torso Change (deg)",
  L_wristTrem= "Left Wrist Tremor Amp",
  L_fingTrem = "Left Fingertip Tremor Amp",
  L_freq     = "Left Tremor Freq (Hz)",
  L_stab     = "Left Stability",
  L_curl     = "Left Finger Curl Change",
  L_spread   = "Left Finger Spread Change",
  R_maxDrift = "Right Max Drift (norm)",
  R_onset    = "Right Drift Onset (s)",
  R_dur      = "Right Drift Duration (ms)",
  R_sustained= "Right Sustained Drift",
  R_pron     = "Right Pronation (deg)",
  R_possPron = "Right Possible Pronation",
  R_elbowFlex= "Right Elbow Flexion Change (deg)",
  R_armTorso = "Right Arm-to-Torso Change (deg)",
  R_wristTrem= "Right Wrist Tremor Amp",
  R_fingTrem = "Right Fingertip Tremor Amp",
  R_freq     = "Right Tremor Freq (Hz)",
  R_stab     = "Right Stability",
  R_curl     = "Right Finger Curl Change",
  R_spread   = "Right Finger Spread Change",
  outside    = "Any Indicator Outside Range"
)

# ---- Data dictionary (plain-language, for tooltips + Explorer tab) -----------
DICTIONARY <- tibble::tribble(
  ~Metric,                    ~Meaning,
  "Max Drift (norm)",         "Largest downward wrist movement from the starting pose, divided by arm length so it is comparable across people. Higher = more drift. The core sign of arm weakness.",
  "Drift Onset (s)",          "How many seconds into the 30-second hold the drift first became significant. Earlier onset can indicate a more pronounced effect.",
  "Drift Duration (ms)",      "Total time the arm held a significant downward drift. Longer sustained drift is more meaningful than a brief dip.",
  "Sustained Drift",          "TRUE when drift stayed above threshold continuously for at least ~2 seconds.",
  "Pronation (deg)",          "How far the palm rotated from palms-up toward palms-down during the hold. Downward drift WITH pronation is the classic pyramidal-tract pattern.",
  "Possible Pronation",       "TRUE when the palm rotation was sustained past the prototype threshold (noise-robust).",
  "Elbow Flexion Change (deg)","How much the elbow bent from straight during the hold. Large bending suggests the arm is collapsing.",
  "Arm-to-Torso Change (deg)","How much the whole arm lowered/abducted relative to the body.",
  "Wrist Tremor Amp",         "Amount of fine high-frequency wrist oscillation (instability). Higher = shakier hold.",
  "Fingertip Tremor Amp",     "Same idea for the fingertips (needs hand tracking).",
  "Tremor Freq (Hz)",         "Dominant frequency of the wrist oscillation. 8-12 Hz is a prototype physiological-tremor reference band.",
  "Stability",               "A 0-1 steadiness score (1 = perfectly steady). Derived from oscillation amplitude.",
  "Finger Curl Change",       "Increase in finger curl from baseline (fingers flexing during the hold).",
  "Finger Spread Change",     "Change in how splayed the knuckles are.",
  "Valid Frame %",            "Share of camera frames good enough to analyse. Low values mean a less reliable result.",
  "Effective FPS",            "Frames per second actually analysed. Below ~10 fps the result is flagged reduced-reliability.",
  "Quality",                 "Overall session quality rating: good / acceptable / low / unable_to_assess."
)

CLASS_LABELS <- c(
  "no_significant_drift"            = "No significant drift",
  "possible_left_pronator_drift"    = "Possible LEFT pronator drift",
  "possible_right_pronator_drift"   = "Possible RIGHT pronator drift",
  "possible_bilateral_drift"        = "Possible bilateral drift",
  "drift_without_clear_pronation"   = "Drift without clear pronation",
  "possible_pronation_without_drift"= "Pronation without drift",
  "unable_to_assess"                = "Unable to assess"
)

# ---- Helpers -----------------------------------------------------------------
as_num  <- function(x) suppressWarnings(as.numeric(gsub("[^0-9eE.+-]", "", as.character(x))))
as_bool <- function(x) toupper(trimws(as.character(x))) %in% c("TRUE", "YES", "1")

# Element-wise max of two vectors that returns NA (not -Inf) when both are NA.
pmax_safe <- function(a, b) {
  out <- pmax(a, b, na.rm = TRUE)
  out[is.na(a) & is.na(b)] <- NA_real_
  out[is.infinite(out)] <- NA_real_
  out
}

# Parse the sheet, coercing types and adding derived asymmetry columns.
load_data <- function() {
  url <- sheet_csv_url(SHEET_ID, SHEET_TAB)
  df <- tryCatch(
    utils::read.csv(url, check.names = FALSE, stringsAsFactors = FALSE),
    error = function(e) NULL
  )
  if (is.null(df) || nrow(df) == 0) return(demo_data())

  num_cols <- c(COLS$age, COLS$duration, COLS$validPct, COLS$poseConf, COLS$camStab, COLS$fps,
                COLS$L_maxDrift, COLS$L_onset, COLS$L_dur, COLS$L_pron, COLS$L_elbowFlex,
                COLS$L_armTorso, COLS$L_wristTrem, COLS$L_fingTrem, COLS$L_freq, COLS$L_stab,
                COLS$L_curl, COLS$L_spread,
                COLS$R_maxDrift, COLS$R_onset, COLS$R_dur, COLS$R_pron, COLS$R_elbowFlex,
                COLS$R_armTorso, COLS$R_wristTrem, COLS$R_fingTrem, COLS$R_freq, COLS$R_stab,
                COLS$R_curl, COLS$R_spread)
  for (c in intersect(num_cols, names(df))) df[[c]] <- as_num(df[[c]])
  for (c in intersect(c(COLS$L_sustained, COLS$R_sustained, COLS$L_possPron,
                        COLS$R_possPron, COLS$outside, COLS$declaration), names(df))) {
    df[[c]] <- as_bool(df[[c]])
  }

  # Derived: absolute L-R asymmetry on the core metrics.
  saf <- function(col) if (col %in% names(df)) df[[col]] else NA_real_
  df$`Drift Asymmetry`     <- abs(saf(COLS$L_maxDrift) - saf(COLS$R_maxDrift))
  df$`Pronation Asymmetry` <- abs(saf(COLS$L_pron)     - saf(COLS$R_pron))
  df$`Stability Asymmetry` <- abs(saf(COLS$L_stab)     - saf(COLS$R_stab))
  df$`Max Drift (either)`  <- pmax_safe(saf(COLS$L_maxDrift), saf(COLS$R_maxDrift))

  # Parse a POSIXct test time when possible.
  if (COLS$testTime %in% names(df)) {
    df$`.testTime` <- tryCatch(as.POSIXct(df[[COLS$testTime]], tz = "UTC",
                                          format = "%Y-%m-%dT%H:%M:%OSZ"),
                               error = function(e) as.POSIXct(NA))
    if (all(is.na(df$`.testTime`))) {
      df$`.testTime` <- suppressWarnings(as.POSIXct(df[[COLS$testTime]]))
    }
  }
  df
}

# A small, realistic demo dataset so the dashboard renders before the sheet is
# configured (and during shinyapps.io preview).
demo_data <- function() {
  set.seed(42)
  n <- 60
  genders <- sample(c("female", "male", "other"), n, replace = TRUE, prob = c(.5, .45, .05))
  age <- round(rnorm(n, 52, 16)); age[age < 18] <- 18
  Ld <- pmax(0, rnorm(n, 0.02, 0.02)); Rd <- pmax(0, rnorm(n, 0.02, 0.02))
  # Inject a few asymmetric "possible drift" cases.
  idx <- sample(n, 10); Rd[idx] <- Rd[idx] + runif(10, 0.03, 0.08)
  df <- data.frame(check.names = FALSE,
    `Participant Name` = paste0("P", sprintf("%03d", seq_len(n))),
    Gender = genders, Age = age,
    `Declaration Accepted` = TRUE,
    `Test Date/Time` = format(Sys.time() - runif(n, 0, 60) * 86400, "%Y-%m-%dT%H:%M:%SZ"),
    `Duration (s)` = 30, Device = sample(c("desktop","mobile","tablet"), n, TRUE),
    `Overall Classification` = "no_significant_drift",
    `Assessed Arm` = ifelse(Rd > Ld, "right", "left"),
    Quality = sample(c("good","acceptable","low"), n, TRUE, c(.6,.3,.1)),
    `Valid Frame %` = round(runif(n, 70, 100), 1),
    `Avg Pose Confidence` = round(runif(n, .6, .95), 2),
    `Camera Stability` = round(runif(n, .7, 1), 2),
    `Effective FPS` = round(runif(n, 9, 30), 1),
    `Left Max Drift (norm)` = round(Ld, 4), `Right Max Drift (norm)` = round(Rd, 4),
    `Left Drift Onset (s)` = round(runif(n, 3, 20), 1), `Right Drift Onset (s)` = round(runif(n, 3, 20), 1),
    `Left Drift Duration (ms)` = round(runif(n, 0, 8000)), `Right Drift Duration (ms)` = round(runif(n, 0, 8000)),
    `Left Sustained Drift` = Ld > 0.03, `Right Sustained Drift` = Rd > 0.03,
    `Left Pronation (deg)` = round(rnorm(n, 8, 6)), `Right Pronation (deg)` = round(rnorm(n, 8, 6)),
    `Left Possible Pronation` = FALSE, `Right Possible Pronation` = Rd > 0.05,
    `Left Elbow Flexion Change (deg)` = round(rnorm(n, 5, 4)), `Right Elbow Flexion Change (deg)` = round(rnorm(n, 5, 4)),
    `Left Arm-to-Torso Change (deg)` = round(rnorm(n, 4, 3)), `Right Arm-to-Torso Change (deg)` = round(rnorm(n, 4, 3)),
    `Left Wrist Tremor Amp` = round(abs(rnorm(n, .01, .006)), 4), `Right Wrist Tremor Amp` = round(abs(rnorm(n, .01, .006)), 4),
    `Left Fingertip Tremor Amp` = round(abs(rnorm(n, .012, .007)), 4), `Right Fingertip Tremor Amp` = round(abs(rnorm(n, .012, .007)), 4),
    `Left Tremor Freq (Hz)` = round(runif(n, 6, 13), 1), `Right Tremor Freq (Hz)` = round(runif(n, 6, 13), 1),
    `Left Stability` = round(runif(n, .6, .99), 3), `Right Stability` = round(runif(n, .6, .99), 3),
    `Left Finger Curl Change` = round(rnorm(n, .02, .02), 3), `Right Finger Curl Change` = round(rnorm(n, .02, .02), 3),
    `Left Finger Spread Change` = round(rnorm(n, .01, .02), 3), `Right Finger Spread Change` = round(rnorm(n, .01, .02), 3),
    `Any Indicator Outside Range` = Rd > 0.05
  )
  df$`Overall Classification`[df$`Right Possible Pronation` & df$`Right Sustained Drift`] <- "possible_right_pronator_drift"
  df$`Drift Asymmetry`     <- abs(df$`Left Max Drift (norm)` - df$`Right Max Drift (norm)`)
  df$`Pronation Asymmetry` <- abs(df$`Left Pronation (deg)`  - df$`Right Pronation (deg)`)
  df$`Stability Asymmetry` <- abs(df$`Left Stability`        - df$`Right Stability`)
  df$`Max Drift (either)`  <- pmax(df$`Left Max Drift (norm)`, df$`Right Max Drift (norm)`)
  df$`.testTime`           <- suppressWarnings(as.POSIXct(df$`Test Date/Time`, format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"))
  df
}

# ---- ggplot theme ------------------------------------------------------------
theme_pd <- function(base = 13) {
  theme_minimal(base_size = base) +
    theme(
      plot.background  = element_rect(fill = PAL$surface, colour = NA),
      panel.background = element_rect(fill = PAL$surface, colour = NA),
      panel.grid.major = element_line(colour = PAL$grid, linewidth = .3),
      panel.grid.minor = element_blank(),
      text        = element_text(colour = PAL$ink),
      axis.text   = element_text(colour = PAL$muted),
      plot.title  = element_text(colour = PAL$cyan, face = "bold"),
      plot.subtitle = element_text(colour = PAL$muted),
      legend.background = element_rect(fill = PAL$surface, colour = NA),
      legend.key  = element_rect(fill = PAL$surface, colour = NA)
    )
}

# Continuous metric menu shared across explorer tabs.
CONT_CHOICES <- c(
  "Age (years)"                       = COLS$age,
  "Max drift — LEFT (norm.)"          = COLS$L_maxDrift,
  "Max drift — RIGHT (norm.)"         = COLS$R_maxDrift,
  "Max drift — worst arm"             = "Max Drift (either)",
  "Drift asymmetry (|L-R|)"           = "Drift Asymmetry",
  "Pronation — LEFT (deg)"            = COLS$L_pron,
  "Pronation — RIGHT (deg)"           = COLS$R_pron,
  "Pronation asymmetry (|L-R|)"       = "Pronation Asymmetry",
  "Elbow flexion change — LEFT (deg)" = COLS$L_elbowFlex,
  "Elbow flexion change — RIGHT (deg)"= COLS$R_elbowFlex,
  "Wrist tremor amp — LEFT"           = COLS$L_wristTrem,
  "Wrist tremor amp — RIGHT"          = COLS$R_wristTrem,
  "Tremor frequency — LEFT (Hz)"      = COLS$L_freq,
  "Tremor frequency — RIGHT (Hz)"     = COLS$R_freq,
  "Stability — LEFT (0-1)"            = COLS$L_stab,
  "Stability — RIGHT (0-1)"           = COLS$R_stab,
  "Stability asymmetry (|L-R|)"       = "Stability Asymmetry",
  "Valid frame %"                     = COLS$validPct,
  "Effective FPS"                     = COLS$fps
)

# ---- UI ----------------------------------------------------------------------
info_box <- function(title, body) {
  div(class = "pd-note",
      tags$div(class = "pd-note-title", title),
      tags$div(class = "pd-note-body", body))
}

kpi <- function(id, label) {
  div(class = "pd-kpi",
      div(class = "pd-kpi-value", textOutput(id, inline = TRUE)),
      div(class = "pd-kpi-label", label))
}

pd_theme <- bs_theme(
  version = 5, bg = PAL$bg, fg = PAL$ink,
  primary = PAL$cyan, secondary = PAL$teal,
  base_font = font_google("Inter"), heading_font = font_google("Inter")
)

ui <- navbarPage(
  title = div(span("🩺", style = "margin-right:8px"), "Pronator Drift — Analytics & Education"),
  theme = pd_theme, collapsible = TRUE, id = "nav",
  header = tags$head(tags$style(HTML(sprintf("
    body { background:%s; }
    .pd-note { background:%s; border-left:4px solid %s; border-radius:8px;
               padding:12px 16px; margin:10px 0; }
    .pd-note-title { color:%s; font-weight:700; margin-bottom:4px; }
    .pd-note-body { color:%s; font-size:.95rem; line-height:1.5; }
    .pd-kpi { background:%s; border:1px solid %s; border-radius:14px;
              padding:16px; text-align:center; }
    .pd-kpi-value { font-size:2rem; font-weight:800; color:%s; }
    .pd-kpi-label { color:%s; font-size:.85rem; text-transform:uppercase;
                    letter-spacing:.05em; }
    .card, .well, .tab-content { background:%s; }
    .nav-tabs .nav-link.active { color:%s; }
    h2,h3,h4 { color:%s; }
  ", PAL$bg, PAL$surface, PAL$cyan, PAL$cyan, PAL$muted, PAL$surface, PAL$grid,
     PAL$cyan, PAL$muted, PAL$surface, PAL$cyan, PAL$ink)))),

  # ---- Overview -------------------------------------------------------------
  tabPanel("Overview",
    fluidRow(
      column(2, kpi("kpiN", "Assessments")),
      column(2, kpi("kpiPeople", "Participants")),
      column(2, kpi("kpiFlagged", "Outside range")),
      column(2, kpi("kpiDrift", "Median worst drift")),
      column(2, kpi("kpiQuality", "Good/acceptable")),
      column(2, kpi("kpiAge", "Median age"))
    ),
    br(),
    fluidRow(
      column(7,
        h4("What the pronator drift test measures"),
        info_box("The manoeuvre",
          HTML("The participant holds both arms straight out, <b>palms up</b>, with
                <b>eyes closed</b>, for 30 seconds. Removing vision stops the brain
                from secretly correcting a weak arm. A camera + on-device computer
                vision then track both arms and measure three classic signs:")),
        info_box("① Downward drift",
          "A weaker arm slowly sinks. We measure the wrist's downward movement, scaled by arm length so it is comparable across people."),
        info_box("② Pronation",
          "The palm rotates from up toward down. Downward drift WITH pronation is the textbook pattern of an upper-motor-neuron (pyramidal) lesion."),
        info_box("③ Finger flexion & tremor",
          "Subtle finger curl and fine oscillation (tremor) can accompany weakness. Stability is a 0-1 steadiness score."),
        info_box("Read results as SCREENING, not diagnosis",
          "Every threshold here is a prototype pending clinical validation. Upward/outward drift can reflect sensory (proprioceptive) rather than motor causes. Use these views to explore patterns, not to diagnose.")
      ),
      column(5,
        h4("Classification mix"),
        if (have_plotly) plotly::plotlyOutput("ovClass", height = 300) else plotOutput("ovClass", height = 300),
        br(),
        h4("Assessments over time"),
        plotOutput("ovTimeline", height = 220)
      )
    )
  ),

  # ---- Participants ---------------------------------------------------------
  tabPanel("Participants",
    info_box("About this view",
      "Who has been screened. Understanding the cohort (age, gender, device) is essential before interpreting any group differences — e.g. tremor naturally rises with age."),
    fluidRow(
      column(6, h4("Age distribution"), plotOutput("pAge", height = 300)),
      column(6, h4("Gender mix"), plotOutput("pGender", height = 300))
    ),
    fluidRow(
      column(6, h4("Worst-arm drift by age"), plotOutput("pAgeDrift", height = 300)),
      column(6, h4("Device used"), plotOutput("pDevice", height = 300))
    )
  ),

  # ---- Drift & Pronation ----------------------------------------------------
  tabPanel("Drift & Pronation",
    info_box("About this view",
      HTML("The two core signs, shown for the LEFT (blue) and RIGHT (pink) arm.
            The dashed band is the <b>prototype</b> typical range (drift 0-0.03 norm;
            pronation 0-15°). Points beyond it are worth a closer look — but remember
            these ranges are not yet clinically validated.")),
    fluidRow(
      column(6, h4("Max drift — left vs right"),
        if (have_plotly) plotly::plotlyOutput("dpDrift", height = 340) else plotOutput("dpDrift", height = 340)),
      column(6, h4("Pronation — left vs right"),
        if (have_plotly) plotly::plotlyOutput("dpPron", height = 340) else plotOutput("dpPron", height = 340))
    ),
    fluidRow(
      column(12, h4("Drift vs pronation (the diagnostic quadrant)"),
        info_box("How to read it",
          HTML("Down-and-right (high drift + high pronation) is the classic pyramidal
                pattern. High drift with low pronation is non-specific. High pronation
                with low drift is weaker evidence. Colour = overall classification.")),
        if (have_plotly) plotly::plotlyOutput("dpQuad", height = 420) else plotOutput("dpQuad", height = 420))
    )
  ),

  # ---- Asymmetry ------------------------------------------------------------
  tabPanel("Left–Right Asymmetry",
    info_box("About this view",
      "Pronator drift is fundamentally about ASYMMETRY — one arm behaving differently from the other. These views isolate the difference between arms, which is often more informative than either arm alone."),
    fluidRow(
      column(6, h4("Left vs right max drift (per assessment)"),
        if (have_plotly) plotly::plotlyOutput("asScatter", height = 360) else plotOutput("asScatter", height = 360)),
      column(6, h4("Distribution of drift asymmetry |L−R|"),
        plotOutput("asHist", height = 360))
    ),
    fluidRow(column(12, h4("Paired left vs right (mean ± 95% CI)"), plotOutput("asPaired", height = 300),
      verbatimTextOutput("asTest")))
  ),

  # ---- Tremor & Stability ---------------------------------------------------
  tabPanel("Tremor & Stability",
    info_box("About this view",
      HTML("Fine oscillation (tremor) and steadiness. The shaded band marks the
            <b>8–12 Hz</b> physiological-tremor reference. Stability is 1/(1+amplitude):
            closer to 1 means a steadier hold.")),
    fluidRow(
      column(6, h4("Tremor dominant frequency"), plotOutput("tFreq", height = 320)),
      column(6, h4("Stability — left vs right"), plotOutput("tStab", height = 320))
    ),
    fluidRow(
      column(6, h4("Wrist vs fingertip tremor amplitude"),
        if (have_plotly) plotly::plotlyOutput("tAmp", height = 320) else plotOutput("tAmp", height = 320)),
      column(6, h4("Finger curl vs spread change"), plotOutput("tFinger", height = 320))
    )
  ),

  # ---- Relationships --------------------------------------------------------
  tabPanel("Relationships",
    sidebarLayout(
      sidebarPanel(width = 3,
        h4("Scatter explorer"),
        selectInput("xvar", "X axis", CONT_CHOICES, selected = COLS$age),
        selectInput("yvar", "Y axis", CONT_CHOICES, selected = "Max Drift (either)"),
        selectInput("colorby", "Colour by",
          c("Overall Classification" = COLS$classification,
            "Gender" = COLS$gender, "Quality" = COLS$quality,
            "Assessed Arm" = COLS$assessedArm), selected = COLS$classification),
        checkboxInput("addfit", "Add trend line (loess)", TRUE),
        info_box("Reading correlations",
          "A trend is a pattern in THIS sample, not proof of cause. Confounders (like age) can create or hide relationships.")
      ),
      mainPanel(width = 9,
        h4("Metric relationships"),
        if (have_plotly) plotly::plotlyOutput("relScatter", height = 380) else plotOutput("relScatter", height = 380),
        br(),
        h4("Correlation heatmap"),
        info_box("About this view",
          "Pearson correlation between the core numeric metrics. Warm = positive, cool = negative. Use it to spot which measures move together."),
        plotOutput("relHeat", height = 460)
      )
    )
  ),

  # ---- Quality --------------------------------------------------------------
  tabPanel("Quality & Reliability",
    info_box("About this view",
      "Not every recording is equally trustworthy. Low valid-frame % or low frame rate means the numbers should be read with caution. Filter these out before drawing conclusions."),
    fluidRow(
      column(6, h4("Quality rating mix"), plotOutput("qRating", height = 300)),
      column(6, h4("Valid frame % vs effective FPS"),
        if (have_plotly) plotly::plotlyOutput("qScatter", height = 300) else plotOutput("qScatter", height = 300))
    ),
    fluidRow(column(12, h4("Does quality relate to measured drift?"),
      info_box("Why this matters",
        "If poor-quality sessions show systematically different drift, some 'findings' may be artefacts of tracking rather than real movement."),
      plotOutput("qVsDrift", height = 320)))
  ),

  # ---- Data Explorer --------------------------------------------------------
  tabPanel("Data Explorer",
    fluidRow(
      column(8, h4("Live data"),
        info_box("About this view",
          "The full aggregated table, straight from your Google Sheet. Search, sort, and download for your own analysis.")),
      column(4, br(), downloadButton("dl", "Download CSV", class = "btn-primary"))
    ),
    DT::dataTableOutput("tbl"),
    br(), h4("Data dictionary"),
    DT::dataTableOutput("dict")
  )
)

# ---- Server ------------------------------------------------------------------
server <- function(input, output, session) {

  data <- reactivePoll(AUTO_REFRESH_MS, session,
    checkFunc = function() Sys.time(),
    valueFunc = function() load_data())

  num <- function(df, key) if (key %in% names(df)) df[[key]] else rep(NA_real_, nrow(df))

  # ---- KPIs ----
  output$kpiN       <- renderText(nrow(data()))
  output$kpiPeople  <- renderText({ d <- data(); if (COLS$name %in% names(d)) length(unique(d[[COLS$name]])) else nrow(d) })
  output$kpiFlagged <- renderText({ d <- data(); if (COLS$outside %in% names(d)) sum(as_bool(d[[COLS$outside]]), na.rm = TRUE) else 0 })
  output$kpiDrift   <- renderText({ v <- num(data(), "Max Drift (either)"); if (all(is.na(v))) "—" else sprintf("%.1f%%", 100 * median(v, na.rm = TRUE)) })
  output$kpiQuality <- renderText({ d <- data(); if (!COLS$quality %in% names(d)) return("—")
    q <- tolower(d[[COLS$quality]]); sprintf("%.0f%%", 100 * mean(q %in% c("good","acceptable"), na.rm = TRUE)) })
  output$kpiAge     <- renderText({ v <- num(data(), COLS$age); if (all(is.na(v))) "—" else round(median(v, na.rm = TRUE)) })

  # ---- Overview ----
  render_class <- function() {
    d <- data(); if (!COLS$classification %in% names(d)) return(NULL)
    tab <- d %>% count(cls = .data[[COLS$classification]]) %>%
      mutate(label = ifelse(cls %in% names(CLASS_LABELS), CLASS_LABELS[cls], cls))
    g <- ggplot(tab, aes(reorder(label, n), n, fill = cls)) +
      geom_col() + coord_flip() +
      scale_fill_manual(values = CLASS_COLORS, guide = "none") +
      labs(x = NULL, y = "Assessments") + theme_pd()
    g
  }
  if (have_plotly) output$ovClass <- plotly::renderPlotly({ g <- render_class(); if (is.null(g)) return(NULL); plotly::ggplotly(g) })
  else output$ovClass <- renderPlot({ render_class() })

  output$ovTimeline <- renderPlot({
    d <- data(); if (!".testTime" %in% names(d) || all(is.na(d$`.testTime`))) {
      return(ggplot() + annotate("text", 1, 1, label = "No timestamps yet", colour = PAL$muted) + theme_pd())
    }
    d$day <- as.Date(d$`.testTime`)
    d %>% count(day) %>% ggplot(aes(day, n)) +
      geom_col(fill = PAL$cyan) + labs(x = NULL, y = "Assessments") + theme_pd()
  })

  # ---- Participants ----
  output$pAge <- renderPlot({
    v <- num(data(), COLS$age); v <- v[!is.na(v)]; if (!length(v)) return(NULL)
    ggplot(data.frame(v), aes(v)) +
      geom_histogram(bins = 20, fill = PAL$cyan, colour = PAL$bg) +
      labs(x = "Age (years)", y = "Count") + theme_pd()
  })
  output$pGender <- renderPlot({
    d <- data(); if (!COLS$gender %in% names(d)) return(NULL)
    d %>% count(g = .data[[COLS$gender]]) %>%
      ggplot(aes(reorder(g, n), n, fill = g)) + geom_col() + coord_flip() +
      scale_fill_manual(values = c(female = PAL$right, male = PAL$left,
        other = PAL$teal, prefer_not_to_say = PAL$muted), guide = "none") +
      labs(x = NULL, y = "Count") + theme_pd()
  })
  output$pAgeDrift <- renderPlot({
    d <- data(); ggplot(d, aes(num(d, COLS$age), num(d, "Max Drift (either)"))) +
      geom_point(colour = PAL$cyan, alpha = .7, size = 2.5) +
      geom_smooth(method = "loess", se = TRUE, colour = PAL$warn, fill = PAL$grid) +
      labs(x = "Age (years)", y = "Worst-arm max drift (norm.)") + theme_pd()
  })
  output$pDevice <- renderPlot({
    d <- data(); if (!COLS$device %in% names(d)) return(NULL)
    d %>% count(dev = .data[[COLS$device]]) %>%
      ggplot(aes(reorder(dev, n), n, fill = dev)) + geom_col(fill = PAL$teal) +
      coord_flip() + labs(x = NULL, y = "Count") + theme_pd()
  })

  # ---- Drift & Pronation ----
  lr_long <- function(dfcols, lab) {
    d <- data()
    tibble(value = c(num(d, dfcols[1]), num(d, dfcols[2])),
           Arm = rep(c("Left","Right"), each = nrow(d))) %>% filter(!is.na(value))
  }
  drift_plot <- function() {
    ld <- lr_long(c(COLS$L_maxDrift, COLS$R_maxDrift))
    ggplot(ld, aes(Arm, value, fill = Arm)) +
      geom_violin(alpha = .35, colour = NA) +
      geom_jitter(aes(colour = Arm), width = .12, alpha = .7, size = 2) +
      geom_hline(yintercept = 0.03, linetype = "dashed", colour = PAL$warn) +
      scale_fill_manual(values = c(Left = PAL$left, Right = PAL$right), guide = "none") +
      scale_colour_manual(values = c(Left = PAL$left, Right = PAL$right), guide = "none") +
      labs(x = NULL, y = "Max drift (norm.)", subtitle = "Dashed = prototype 0.03 threshold") + theme_pd()
  }
  pron_plot <- function() {
    ld <- lr_long(c(COLS$L_pron, COLS$R_pron))
    ggplot(ld, aes(Arm, value, fill = Arm)) +
      geom_violin(alpha = .35, colour = NA) +
      geom_jitter(aes(colour = Arm), width = .12, alpha = .7, size = 2) +
      geom_hline(yintercept = 15, linetype = "dashed", colour = PAL$warn) +
      scale_fill_manual(values = c(Left = PAL$left, Right = PAL$right), guide = "none") +
      scale_colour_manual(values = c(Left = PAL$left, Right = PAL$right), guide = "none") +
      labs(x = NULL, y = "Palm rotation change (deg)", subtitle = "Dashed = prototype 15° threshold") + theme_pd()
  }
  quad_plot <- function() {
    d <- data()
    q <- tibble(
      drift = pmax_safe(num(d, COLS$L_maxDrift), num(d, COLS$R_maxDrift)),
      pron  = pmax_safe(num(d, COLS$L_pron),     num(d, COLS$R_pron)),
      cls   = if (COLS$classification %in% names(d)) d[[COLS$classification]] else "n/a")
    ggplot(q, aes(drift, pron, colour = cls)) +
      geom_vline(xintercept = 0.03, linetype = "dashed", colour = PAL$grid) +
      geom_hline(yintercept = 15,   linetype = "dashed", colour = PAL$grid) +
      geom_point(size = 3, alpha = .8) +
      scale_colour_manual(values = CLASS_COLORS, name = "Classification") +
      labs(x = "Worst-arm max drift (norm.)", y = "Worst-arm pronation (deg)") + theme_pd()
  }
  if (have_plotly) { output$dpDrift <- plotly::renderPlotly(plotly::ggplotly(drift_plot()))
                     output$dpPron  <- plotly::renderPlotly(plotly::ggplotly(pron_plot()))
                     output$dpQuad  <- plotly::renderPlotly(plotly::ggplotly(quad_plot())) }
  else { output$dpDrift <- renderPlot(drift_plot()); output$dpPron <- renderPlot(pron_plot()); output$dpQuad <- renderPlot(quad_plot()) }

  # ---- Asymmetry ----
  as_scatter <- function() {
    d <- data()
    ggplot(d, aes(num(d, COLS$L_maxDrift), num(d, COLS$R_maxDrift))) +
      geom_abline(slope = 1, intercept = 0, colour = PAL$grid, linetype = "dashed") +
      geom_point(colour = PAL$cyan, alpha = .75, size = 2.6) +
      labs(x = "Left max drift (norm.)", y = "Right max drift (norm.)",
           subtitle = "Points off the diagonal = asymmetry between arms") + theme_pd()
  }
  if (have_plotly) output$asScatter <- plotly::renderPlotly(plotly::ggplotly(as_scatter()))
  else output$asScatter <- renderPlot(as_scatter())
  output$asHist <- renderPlot({
    v <- num(data(), "Drift Asymmetry"); v <- v[!is.na(v)]; if (!length(v)) return(NULL)
    ggplot(data.frame(v), aes(v)) +
      geom_histogram(bins = 20, fill = PAL$teal, colour = PAL$bg) +
      labs(x = "|Left − Right| max drift (norm.)", y = "Count") + theme_pd()
  })
  output$asPaired <- renderPlot({
    d <- data(); L <- num(d, COLS$L_maxDrift); R <- num(d, COLS$R_maxDrift)
    s <- tibble(Arm = c("Left","Right"),
                m = c(mean(L, na.rm = TRUE), mean(R, na.rm = TRUE)),
                se = c(sd(L, na.rm = TRUE)/sqrt(sum(!is.na(L))), sd(R, na.rm = TRUE)/sqrt(sum(!is.na(R)))))
    ggplot(s, aes(Arm, m, fill = Arm)) +
      geom_col(width = .5) +
      geom_errorbar(aes(ymin = m - 1.96*se, ymax = m + 1.96*se), width = .15, colour = PAL$ink) +
      scale_fill_manual(values = c(Left = PAL$left, Right = PAL$right), guide = "none") +
      labs(x = NULL, y = "Mean max drift (norm.)") + theme_pd()
  })
  output$asTest <- renderPrint({
    d <- data(); L <- num(d, COLS$L_maxDrift); R <- num(d, COLS$R_maxDrift)
    ok <- !is.na(L) & !is.na(R)
    if (sum(ok) < 3) { cat("Not enough paired rows for a test yet."); return(invisible()) }
    print(t.test(L[ok], R[ok], paired = TRUE))
  })

  # ---- Tremor & Stability ----
  output$tFreq <- renderPlot({
    ld <- lr_long(c(COLS$L_freq, COLS$R_freq))
    ggplot(ld, aes(value, fill = Arm)) +
      annotate("rect", xmin = 8, xmax = 12, ymin = -Inf, ymax = Inf, fill = PAL$warn, alpha = .12) +
      geom_density(alpha = .4, colour = NA) +
      scale_fill_manual(values = c(Left = PAL$left, Right = PAL$right)) +
      labs(x = "Dominant tremor frequency (Hz)", y = "Density",
           subtitle = "Shaded = 8–12 Hz physiological band (prototype)") + theme_pd()
  })
  output$tStab <- renderPlot({
    ld <- lr_long(c(COLS$L_stab, COLS$R_stab))
    ggplot(ld, aes(Arm, value, fill = Arm)) +
      geom_boxplot(alpha = .5, outlier.colour = PAL$warn) +
      scale_fill_manual(values = c(Left = PAL$left, Right = PAL$right), guide = "none") +
      labs(x = NULL, y = "Stability (0–1, higher = steadier)") + theme_pd()
  })
  amp_plot <- function() {
    d <- data()
    tibble(wrist = c(num(d, COLS$L_wristTrem), num(d, COLS$R_wristTrem)),
           fing  = c(num(d, COLS$L_fingTrem),  num(d, COLS$R_fingTrem)),
           Arm   = rep(c("Left","Right"), each = nrow(d))) %>%
      ggplot(aes(wrist, fing, colour = Arm)) +
      geom_point(alpha = .75, size = 2.4) +
      scale_colour_manual(values = c(Left = PAL$left, Right = PAL$right)) +
      labs(x = "Wrist tremor amplitude", y = "Fingertip tremor amplitude") + theme_pd()
  }
  if (have_plotly) output$tAmp <- plotly::renderPlotly(plotly::ggplotly(amp_plot()))
  else output$tAmp <- renderPlot(amp_plot())
  output$tFinger <- renderPlot({
    d <- data()
    tibble(curl = c(num(d, COLS$L_curl), num(d, COLS$R_curl)),
           spread = c(num(d, COLS$L_spread), num(d, COLS$R_spread)),
           Arm = rep(c("Left","Right"), each = nrow(d))) %>%
      ggplot(aes(curl, spread, colour = Arm)) +
      geom_point(alpha = .75, size = 2.4) +
      scale_colour_manual(values = c(Left = PAL$left, Right = PAL$right)) +
      labs(x = "Finger curl change", y = "Finger spread change") + theme_pd()
  })

  # ---- Relationships ----
  rel_scatter <- function() {
    d <- data(); cb <- input$colorby
    g <- ggplot(d, aes(num(d, input$xvar), num(d, input$yvar),
                       colour = if (cb %in% names(d)) as.factor(d[[cb]]) else NULL)) +
      geom_point(alpha = .8, size = 2.6) +
      labs(x = names(which(CONT_CHOICES == input$xvar)),
           y = names(which(CONT_CHOICES == input$yvar)), colour = NULL) + theme_pd()
    if (isTRUE(input$addfit)) g <- g + geom_smooth(method = "loess", se = TRUE,
      colour = PAL$warn, fill = PAL$grid)
    if (identical(cb, COLS$classification)) g <- g + scale_colour_manual(values = CLASS_COLORS)
    g
  }
  if (have_plotly) output$relScatter <- plotly::renderPlotly(plotly::ggplotly(rel_scatter()))
  else output$relScatter <- renderPlot(rel_scatter())

  output$relHeat <- renderPlot({
    d <- data()
    keys <- c(COLS$age, COLS$L_maxDrift, COLS$R_maxDrift, COLS$L_pron, COLS$R_pron,
              COLS$L_elbowFlex, COLS$R_elbowFlex, COLS$L_wristTrem, COLS$R_wristTrem,
              COLS$L_freq, COLS$R_freq, COLS$L_stab, COLS$R_stab, COLS$validPct, COLS$fps)
    keys <- intersect(keys, names(d))
    M <- sapply(keys, function(k) num(d, k))
    M <- M[, apply(M, 2, function(x) sum(!is.na(x)) > 2), drop = FALSE]
    if (ncol(M) < 2) return(NULL)
    cm <- cor(M, use = "pairwise.complete.obs")
    cm_long <- as.data.frame(as.table(cm)); names(cm_long) <- c("A","B","r")
    ggplot(cm_long, aes(A, B, fill = r)) + geom_tile() +
      geom_text(aes(label = sprintf("%.2f", r)), size = 2.7, colour = PAL$bg) +
      scale_fill_gradient2(low = PAL$left, mid = PAL$surface, high = PAL$warn,
                           midpoint = 0, limits = c(-1, 1)) +
      theme_pd() + theme(axis.text.x = element_text(angle = 45, hjust = 1)) +
      labs(x = NULL, y = NULL, fill = "r")
  })

  # ---- Quality ----
  output$qRating <- renderPlot({
    d <- data(); if (!COLS$quality %in% names(d)) return(NULL)
    d %>% count(q = .data[[COLS$quality]]) %>%
      ggplot(aes(reorder(q, n), n, fill = q)) + geom_col() + coord_flip() +
      scale_fill_manual(values = c(good = PAL$good, acceptable = PAL$cyan,
        low = PAL$warn, unable_to_assess = PAL$bad), guide = "none") +
      labs(x = NULL, y = "Assessments") + theme_pd()
  })
  qscatter <- function() {
    d <- data()
    ggplot(d, aes(num(d, COLS$validPct), num(d, COLS$fps),
                  colour = if (COLS$quality %in% names(d)) d[[COLS$quality]] else NULL)) +
      geom_hline(yintercept = 10, linetype = "dashed", colour = PAL$warn) +
      geom_point(size = 2.6, alpha = .8) +
      scale_colour_manual(values = c(good = PAL$good, acceptable = PAL$cyan,
        low = PAL$warn, unable_to_assess = PAL$bad), name = "Quality") +
      labs(x = "Valid frame %", y = "Effective FPS",
           subtitle = "Dashed = 10 fps reduced-reliability line") + theme_pd()
  }
  if (have_plotly) output$qScatter <- plotly::renderPlotly(plotly::ggplotly(qscatter()))
  else output$qScatter <- renderPlot(qscatter())
  output$qVsDrift <- renderPlot({
    d <- data(); if (!COLS$quality %in% names(d)) return(NULL)
    tibble(q = d[[COLS$quality]], drift = num(d, "Max Drift (either)")) %>%
      filter(!is.na(drift)) %>%
      ggplot(aes(q, drift, fill = q)) + geom_boxplot(alpha = .5) +
      scale_fill_manual(values = c(good = PAL$good, acceptable = PAL$cyan,
        low = PAL$warn, unable_to_assess = PAL$bad), guide = "none") +
      labs(x = "Quality rating", y = "Worst-arm max drift (norm.)") + theme_pd()
  })

  # ---- Data Explorer ----
  output$tbl <- DT::renderDataTable({
    DT::datatable(data(), options = list(pageLength = 15, scrollX = TRUE),
                  class = "compact stripe", rownames = FALSE)
  })
  output$dict <- DT::renderDataTable({
    DT::datatable(DICTIONARY, options = list(pageLength = 20, dom = "t"),
                  rownames = FALSE)
  })
  output$dl <- downloadHandler(
    filename = function() paste0("pronator_drift_", Sys.Date(), ".csv"),
    content = function(f) utils::write.csv(data(), f, row.names = FALSE))
}

shinyApp(ui, server)
