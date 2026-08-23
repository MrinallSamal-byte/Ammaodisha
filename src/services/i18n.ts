import { useSyncExternalStore } from "react";

export type Lang = "en" | "or";

const STORAGE_KEY = "ao_lang";

type Dictionary = Record<string, string>;

const en: Dictionary = {
  "app.name": "Amma Odisha",
  appTagline: "Report garbage. Hold your ward accountable.",

  "nav.map": "Map",
  "nav.list": "List",
  "nav.nearMe": "Near Me",
  "nav.filters": "Filters",
  "nav.searchPlaceholder": "Search ward, address, landmark",
  "nav.insights": "Insights",
  "nav.about": "About",
  "nav.myReports": "My Reports",

  "action.reportGarbage": "Report garbage",
  "action.submit": "Submit Report",
  "action.submitting": "Submitting...",
  "action.discard": "Discard",
  "action.share": "Share",
  "action.copyLink": "Copy link",
  "action.call": "Call now",
  "action.callBmc": "Call BMC",
  "action.directions": "Get directions",
  "action.confirmSeen": "I've seen this",
  "action.viewOnMap": "View on map",
  "action.retry": "Retry",
  "action.close": "Close",
  "action.back": "Back to map",
  "action.language": "Language",
  "action.loadMore": "Load more reports",
  "action.viewMyReport": "View my report",
  "action.shareYourReport": "Share your report",
  "action.shareWhatsApp": "Share on WhatsApp",

  "status.unresolved": "Unresolved",
  "status.inReview": "In Review",
  "status.cleaned": "Cleaned",
  "status.rejected": "Rejected",
  "status.resolved": "Resolved",

  "status.all": "All status",

  "severity.low": "Minor",
  "severity.medium": "Moderate",
  "severity.high": "Severe",
  "severity.critical": "Critical",

  "severity.all": "All severity",

  "filter.statusActive": "Unresolved / Active",
  "filter.statusCleaned": "Cleaned / Resolved",

  "filters.title": "Search & Filter",
  "filters.dialogLabel": "Search and filter reports",
  "filters.bySeverity": "Filter by severity",
  "filters.byStatus": "Filter by status",
  "filters.search": "Search",
  "filters.searchPlaceholder": "Address, ward, or landmark",
  "filters.severity": "Severity",
  "filters.status": "Status",
  "filters.apply": "Apply",
  "filters.clear": "Clear",

  "form.step1Title": "Where is the garbage?",
  "form.step2Title": "Add photo and landmark",
  "form.step3Title": "Review report",
  "form.chooseArea": "Choose area",
  "form.addEvidence": "Add evidence",
  "form.reviewSubmit": "Review and submit",
  "form.detectWard": "Detecting your area...",
  "form.locating": "Getting your location...",
  "form.takePhoto": "Add photo",
  "form.changePhoto": "Change photo",
  "form.removePhoto": "Remove photo",
  "form.addressLabel": "Landmark / Address",
  "form.wardLabel": "Ward",
  "form.discardTitle": "Discard this report?",
  "form.keepEditing": "Keep editing",
  "form.offlineWarning": "You are offline. Reconnect to submit this report.",
  "form.offlineButton": "Offline - reconnect",
  "form.submitted": "Report submitted",

  "success.title": "Thanks for reporting this spot.",
  "success.subtitle": "Your report is live on the map now.",
  "success.eyebrow": "Report Submitted",

  "freshness.updated": "Updated",

  "myReports.title": "My Reports",
  "myReports.empty": "No reports yet.",
  "myReports.description": "Reports you added from this device.",
  "myReports.view": "View",
  "myReports.live": "Live",
  "myReports.inReviewOrRemoved": "Pending review",

  "quota.left": "{count} of {total} left today",

  "dupes.title": "Possible duplicates nearby",
  "dupes.metersAway": "{count} m away",
  "dupes.viewReport": "View this report",

  "escalation.level1": "Active",
  "escalation.level2": "Aging",
  "escalation.level3": "Stale",
  "escalation.level4": "Critical",
  "escalation.level5": "Emergency",

  "units.minutesAgo": "{count}m ago",
  "units.hoursAgo": "{count}h ago",
  "units.daysAgo": "{count}d ago",
  "units.upvotes": "{count} upvotes",

  "time.justNow": "just now",
  "time.yesterday": "yesterday",

  "offline.notice": "You are offline",
  "error.locationNotFound": "Location not detected",
  "error.refreshFailed": "Refresh failed",

  "list.sortNewest": "Sort: Newest",
  "list.sortUpvoted": "Sort: Most Upvoted",
  "list.sortOldest": "Sort: Oldest",
  "list.empty": "No reports match your current filters.",

  "stats.total": "Total",
  "stats.active": "Active",
  "stats.cleaned": "Cleaned",

  "insights.title": "Citywide report pulse",
  "about.title": "About Amma Odisha",
  "qr.title": "Report on your phone",

  "detail.daysOpen": "{count} days open",
  "detail.verified": "Verified",
  "detail.reportedOn": "Reported {date}",
  "detail.cleanedOn": "Cleaned {date}",
  "detail.cleanedBy": "Cleaned by {name}",
  "detail.photoCredit": "Photo credit: {credit}",

  "status.unresolvedShort": "Open",
  "status.resolvedShort": "Resolved",

  "map.loading": "Loading map…",

  "conn.live": "Live",
  "conn.reconnecting": "Updating…",

  "dupes.more": "{count} more nearby",
  "dupes.noGps": "Add your location to check for duplicates within 100 m.",

  "form.discardViewTitle": "View this report?",
  "form.discardViewBody": "Your draft and photo will be discarded.",
  "form.errDailyLimit": "Daily limit reached. Try again tomorrow.",
  "form.errNetwork": "Could not reach the server. Check your connection.",
  "form.errGeneric": "Submission failed. Try again.",
  "form.stepOf": "Step {step} of 3",
  "form.next": "Next",
  "form.back": "Back",

  "report.missingTitle": "Report unavailable",
  "report.missingBody": "It may have been removed or is still under review.",

  "myReports.unavailable": "Couldn't load status right now.",

  "aria.switchToOdia": "Switch to Odia - current language English",
  "aria.switchToEnglish": "Switch to English - current language Odia",
  "aria.langChangedOdia": "Language changed to Odia",
  "aria.langChangedEnglish": "Language changed to English",
  "aria.close": "Close",
  "aria.openFilters": "Open search and filters",
  "aria.searchReports": "Search reports",
  "aria.sortReports": "Sort reports",
  "aria.nearMe": "Filter reports near my current location",
  "aria.clearWard": "Clear Ward {ward} filter",
  "aria.reportCta": "Report a garbage dump",
  "aria.scanQr": "Scan QR to report",
  "aria.seenThis": "I've seen this too",
  "aria.shareReport": "Share report",

  "escalation.dotAria": "{label}: open for {days} days",

  "list.header": "Live Reports",
  "list.visible": "{count} visible issues",
  "list.publicBadge": "Public",
  "list.emptyArea": "Be the first to report garbage in this area.",

  "insights.queue": "Priority Queue",
  "insights.worst": "Worst wards",

  "detail.statReports": "Confirmations",
  "detail.statDays": "Days open",
  "detail.statCategory": "Waste type",
  "detail.anonymous": "All reports are anonymous.",
  "detail.pendingReview": "Pending review",

  "resolve.title": "Mark as cleaned",
  "resolve.checkAgain": "Check distance again",
  "resolve.submit": "Submit proof",
  "resolve.tooFar": "Move closer to the spot to verify.",
  "resolve.denied": "Enable location access in your browser settings.",
  "resolve.timeout": "Couldn't get a GPS fix. Try again.",

  "admin.compareOriginal": "Original",
  "admin.compareCleanup": "Cleanup proof",
  "admin.rejectReason": "Reason for rejection",
  "admin.loadMore": "Load more",
  "admin.kbdHints": "j/k move - a approve - r reject"
};

const or: Dictionary = {
  "app.name": "Amma Odisha",
  appTagline: "ଆବର୍ଜନା ରିପୋର୍ଟ କରନ୍ତୁ। ନିଜ ୱାର୍ଡ ପାଇଁ ଜବାବଦେହୀ ମାଗନ୍ତୁ।",

  "nav.map": "ନକ୍ସା",
  "nav.list": "ତାଲିକା",
  "nav.nearMe": "ମୋ ନିକଟରେ",
  "nav.filters": "ଫିଲଟର",
  "nav.searchPlaceholder": "ୱାର୍ଡ, ଠିକଣା କିମ୍ବା ଲ୍ୟାଣ୍ଡମାର୍କ ଖୋଜନ୍ତୁ",
  "nav.insights": "ଅନ୍ତର୍ଦୃଷ୍ଟି",
  "nav.about": "ପରିଚୟ",
  "nav.myReports": "ମୋ ରିପୋର୍ଟ",

  "action.reportGarbage": "ଆବର୍ଜନା ରିପୋର୍ଟ କରନ୍ତୁ",
  "action.submit": "ଦାଖଲ କରନ୍ତୁ",
  "action.submitting": "ଦାଖଲ ହେଉଛି...",
  "action.discard": "ବାତିଲ କରନ୍ତୁ",
  "action.share": "ସେୟାର କରନ୍ତୁ",
  "action.copyLink": "ଲିଙ୍କ କପି କରନ୍ତୁ",
  "action.call": "ଏବେ କଲ୍ କରନ୍ତୁ",
  "action.callBmc": "BMC କୁ କଲ୍ କରନ୍ତୁ",
  "action.directions": "ରାସ୍ତା ଦେଖାନ୍ତୁ",
  "action.confirmSeen": "ମୁଁ ଦେଖିଛି",
  "action.viewOnMap": "ନକ୍ସାରେ ଦେଖନ୍ତୁ",
  "action.retry": "ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ",
  "action.close": "ବନ୍ଦ କରନ୍ତୁ",
  "action.back": "ନକ୍ସାକୁ ଫେରନ୍ତୁ",
  "action.language": "ଭାଷା",
  "action.loadMore": "ଅଧିକ ରିପୋର୍ଟ ଦେଖନ୍ତୁ",
  "action.viewMyReport": "ମୋ ରିପୋର୍ଟ ଦେଖନ୍ତୁ",
  "action.shareYourReport": "ରିପୋର୍ଟ ସେୟାର କରନ୍ତୁ",
  "action.shareWhatsApp": "WhatsApp ରେ ସେୟାର କରନ୍ତୁ",

  "status.unresolved": "ସମାଧାନ ହୋଇନାହିଁ",
  "status.inReview": "ସମୀକ୍ଷାଧୀନ",
  "status.cleaned": "ସଫା ହୋଇଛି",
  "status.rejected": "ପ୍ରତ୍ୟାଖ୍ୟାତ",
  "status.resolved": "ସମାଧାନ ହୋଇଛି",

  "status.all": "ସମସ୍ତ ସ୍ଥିତି",

  "severity.low": "ସାମାନ୍ୟ",
  "severity.medium": "ମଧ୍ୟମ",
  "severity.high": "ଗମ୍ଭୀର",
  "severity.critical": "ଅତି ଗମ୍ଭୀର",

  "severity.all": "ସମସ୍ତ ଗମ୍ଭୀରତା",

  "filter.statusActive": "ସମାଧାନ ହୋଇନାହିଁ",
  "filter.statusCleaned": "ସଫା ହୋଇଛି",

  "filters.title": "ଖୋଜ ଓ ଫିଲଟର",
  "filters.search": "ଖୋଜନ୍ତୁ",
  "filters.searchPlaceholder": "ଠିକଣା, ୱାର୍ଡ କିମ୍ବା ଲ୍ୟାଣ୍ଡମାର୍କ",
  "filters.severity": "ଗମ୍ଭୀରତା",
  "filters.status": "ସ୍ଥିତି",
  "filters.apply": "ପ୍ରୟୋଗ କରନ୍ତୁ",
  "filters.clear": "ସଫା କରନ୍ତୁ",
  "filters.dialogLabel": "ରିପୋର୍ଟ ଖୋଜନ୍ତୁ ଓ ଫିଲଟର କରନ୍ତୁ",
  "filters.bySeverity": "ଗୁରୁତ୍ୱ ଅନୁସାରେ ଫିଲଟର",
  "filters.byStatus": "ସ୍ଥିତି ଅନୁସାରେ ଫିଲଟର",

  "form.step1Title": "ଆବର୍ଜନା କେଉଁଠି?",
  "form.step2Title": "ଫଟୋ ଓ ଲ୍ୟାଣ୍ଡମାର୍କ ଯୋଗ କରନ୍ତୁ",
  "form.step3Title": "ରିପୋର୍ଟ ଯାଞ୍ଚ କରନ୍ତୁ",
  "form.chooseArea": "ଅଞ୍ଚଳ ବାଛନ୍ତୁ",
  "form.addEvidence": "ପ୍ରମାଣ ଯୋଗ କରନ୍ତୁ",
  "form.reviewSubmit": "ଯାଞ୍ଚ କରି ଦାଖଲ କରନ୍ତୁ",
  "form.detectWard": "ଆପଣଙ୍କ ଅଞ୍ଚଳ ଚିହ୍ନଟ ହେଉଛି...",
  "form.locating": "ଆପଣଙ୍କ ଅବସ୍ଥିତି ପାଇହେଉଛି...",
  "form.takePhoto": "ଫଟୋ ଯୋଗ କରନ୍ତୁ",
  "form.changePhoto": "ଫଟୋ ବଦଳାନ୍ତୁ",
  "form.removePhoto": "ଫଟୋ ହଟାନ୍ତୁ",
  "form.addressLabel": "ଲ୍ୟାଣ୍ଡମାର୍କ / ଠିକଣା",
  "form.wardLabel": "ୱାର୍ଡ",
  "form.discardTitle": "ଏହି ରିପୋର୍ଟ ପରିତ୍ୟାଗ କରିବେ?",
  "form.keepEditing": "ସମ୍ପାଦନା ଜାରି ରଖନ୍ତୁ",
  "form.offlineWarning": "ଆପଣ ଅଫଲାଇନରେ ଅଛନ୍ତି। ଦାଖଲ କରିବା ପାଇଁ ଇଣ୍ଟରନେଟ୍ ସଂଯୋଗ କରନ୍ତୁ।",
  "form.offlineButton": "ଅଫଲାଇନ - ସଂଯୋଗ କରନ୍ତୁ",
  "form.submitted": "ରିପୋର୍ଟ ଦାଖଲ ହୋଇଛି",

  "success.title": "ଏହି ସ୍ଥାନ ରିପୋର୍ଟ କରିବା ପାଇଁ ଧନ୍ୟବାଦ।",
  "success.subtitle": "ଆପଣଙ୍କ ରିପୋର୍ଟ ବର୍ତ୍ତମାନ ନକ୍ସାରେ ଦେଖାଯାଉଛି।",
  "success.eyebrow": "ରିପୋର୍ଟ ଦାଖଲ",

  "freshness.updated": "ଅପଡେଟ୍ ହୋଇଛି",

  "myReports.title": "ମୋ ରିପୋର୍ଟ",
  "myReports.empty": "ଏପର୍ଯ୍ୟନ୍ତ କୌଣସି ରିପୋର୍ଟ ନାହିଁ।",
  "myReports.description": "ଏହି ଡିଭାଇସରୁ ଆପଣ ଯୋଗ କରିଥିବା ରିପୋର୍ଟ।",
  "myReports.view": "ଦେଖନ୍ତୁ",
  "myReports.live": "ସକ୍ରିୟ",
  "myReports.inReviewOrRemoved": "ସମୀକ୍ଷାରେ ଅଛି",

  "quota.left": "ଆଜି {total} ମଧ୍ୟରୁ {count} ବାକି",

  "dupes.title": "ପାଖରେ ସମାନ ରିପୋର୍ଟ",
  "dupes.metersAway": "{count} ମିଟର ଦୂରରେ",
  "dupes.viewReport": "ଏହି ରିପୋର୍ଟ ଦେଖନ୍ତୁ",

  "escalation.level1": "ସକ୍ରିୟ",
  "escalation.level2": "ପୁରୁଣା",
  "escalation.level3": "ଅବହେଳିତ",
  "escalation.level4": "ଅତି ପୁରୁଣା",
  "escalation.level5": "ଆପାତକାଳୀୟ",

  "units.minutesAgo": "{count} ମି. ପୂର୍ବେ",
  "units.hoursAgo": "{count} ଘ. ପୂର୍ବେ",
  "units.daysAgo": "{count} ଦି. ପୂର୍ବେ",
  "units.upvotes": "{count} ସମର୍ଥନ",

  "time.justNow": "ଏହି କ୍ଷଣି",
  "time.yesterday": "ଗତକାଲି",

  "offline.notice": "ଆପଣ ଅଫଲାଇନ୍ ଅଛନ୍ତି",
  "error.locationNotFound": "ଅବସ୍ଥିତି ଚିହ୍ନଟ ହେଇନାହିଁ",
  "error.refreshFailed": "ରିଫ୍ରେସ୍ ବିଫଳ ହେଲା",

  "list.sortNewest": "ନୂଆରୁ ପୁରୁଣା",
  "list.sortUpvoted": "କ୍ରମ: ଅଧିକ ସମର୍ଥିତ",
  "list.sortOldest": "ପୁରୁଣାରୁ ନୂଆ",
  "list.empty": "ଏହି ଫିଲଟରରେ କୌଣସି ରିପୋର୍ଟ ନାହିଁ।",

  "stats.total": "ମୋଟ",
  "stats.active": "ସକ୍ରିୟ",
  "stats.cleaned": "ସଫା",

  "insights.title": "ସହରବ୍ୟାପୀ ରିପୋର୍ଟ ସ୍ଥିତି",
  "about.title": "ଆମା ଓଡ଼ିଶା ପରିଚୟ",
  "qr.title": "ନିଜ ଫୋନ୍‌ରେ ରିପୋର୍ଟ କରନ୍ତୁ",

  "detail.daysOpen": "{count} ଦିନ ଧରି ଖୋଲା ଅଛି",
  "detail.verified": "ଯାଞ୍ଚିତ",
  "detail.reportedOn": "ରିପୋର୍ଟ: {date}",
  "detail.cleanedOn": "ସଫା: {date}",
  "detail.cleanedBy": "{name} ଦ୍ୱାରା ସଫା",
  "detail.photoCredit": "ଫଟୋ ସୌଜନ୍ୟ: {credit}",

  "status.unresolvedShort": "ଖୋଲା ଅଛି",
  "status.resolvedShort": "ସମାଧାନ",

  "map.loading": "ନକ୍ସା ଲୋଡ୍ ହେଉଛି",

  "conn.live": "ସଜୀବ",
  "conn.reconnecting": "ଅପଡେଟ୍ ହେଉଛି…",

  "dupes.more": "ଆଉ {count} ଟି",
  "dupes.noGps": "ନକଲ ଚେକ ପାଇଁ ନିଜ ଠିକଣା ଯୋଗ କରନ୍ତୁ।",

  "form.discardViewTitle": "ଏହି ରିପୋର୍ଟ ଦେଖିବେ?",
  "form.discardViewBody": "ଆପଣଙ୍କ ଡ୍ରାଫ୍ଟ ବାତିଲ ହୋଇଯିବ।",
  "form.errDailyLimit": "ଦୈନିକ ସୀମା ଶେଷ। ଆସନ୍ତାକାଲି ଚେଷ୍ଟା କରନ୍ତୁ।",
  "form.errNetwork": "ସର୍ଭର ସଂଯୋଗ ହେଲା ନାହିଁ।",
  "form.errGeneric": "ଦାଖଲ ହେଲା ନାହିଁ। ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",
  "form.stepOf": "ପାଦ {step} / 3",
  "form.next": "ଆଗକୁ",
  "form.back": "ପଛକୁ",

  "report.missingTitle": "ରିପୋର୍ଟ ମିଳିଲା ନାହିଁ",
  "report.missingBody": "ଏହା ହଟାଯାଇଥିବା କିମ୍ବା ସମୀକ୍ଷାଧୀନ ହୋଇପାରେ।",

  "myReports.unavailable": "ସ୍ଥିତି ଲୋଡ୍ ହେଲା ନାହିଁ।",

  "aria.switchToOdia": "ଓଡ଼ିଆକୁ ବଦଳାନ୍ତୁ",
  "aria.switchToEnglish": "ଇଂରାଜୀକୁ ବଦଳାନ୍ତୁ",
  "aria.langChangedOdia": "ଭାଷା ଓଡ଼ିଆ ହେଲା",
  "aria.langChangedEnglish": "ଭାଷା ଇଂରାଜୀ ହେଲା",
  "aria.close": "ବନ୍ଦ କରନ୍ତୁ",
  "aria.openFilters": "ଫିଲଟର ଖୋଲନ୍ତୁ",
  "aria.searchReports": "ରିପୋର୍ଟ ଖୋଜନ୍ତୁ",
  "aria.sortReports": "ରିପୋର୍ଟ ସଜାନ୍ତୁ",
  "aria.nearMe": "ମୋ ପାଖରେ ଫିଲଟର",
  "aria.clearWard": "ୱାର୍ଡ {ward} ଫିଲଟର ସଫା",
  "aria.reportCta": "ଆବର୍ଜନା ରିପୋର୍ଟ",
  "aria.scanQr": "QR ସ୍କାନ୍",
  "aria.seenThis": "ମୁଁ ମଧ୍ୟ ଦେଖିଛି",
  "aria.shareReport": "ରିପୋର୍ଟ ସେୟାର",

  "escalation.dotAria": "{label}: {days} ଦିନରୁ ଖୋଲା",

  "list.header": "ଲାଇଭ୍ ରିପୋର୍ଟ",
  "list.visible": "{count} ଟି ଦୃଶ୍ୟମାନ",
  "list.publicBadge": "ସର୍ବସାଧାରଣ",
  "list.emptyArea": "ଏଠାରେ ପ୍ରଥମ ରିପୋର୍ଟ କରନ୍ତୁ।",

  "insights.queue": "ପ୍ରାଥମିକତା ତାଲିକା",
  "insights.worst": "ସବଚେତ ଖରାପ ୱାର୍ଡ",

  "detail.statReports": "ସୁନିଶ୍ଚିତ",
  "detail.statDays": "ଦିନ ଖୋଲା",
  "detail.statCategory": "ଆବର୍ଜନା ପ୍ରକାର",
  "detail.anonymous": "ସମସ୍ତ ରିପୋର୍ଟ ଗୁପ୍ତ।",
  "detail.pendingReview": "ସମୀକ୍ଷା ବାକି",

  "resolve.title": "ସଫା ହୋଇଛି ଚିହ୍ନଟ",
  "resolve.checkAgain": "ଦୂରତା ପୁଣି ଦେଖନ୍ତୁ",
  "resolve.submit": "ପ୍ରମାଣ ଦାଖଲ",
  "resolve.tooFar": "ଯାଞ୍ଚ ପାଇଁ ପାଖକୁ ଆସନ୍ତୁ।",
  "resolve.denied": "ବ୍ରାଉଜରରେ ଲୋକେସନ୍ ଅନୁମତି ଦିଅନ୍ତୁ।",
  "resolve.timeout": "GPS ମିଳିଲା ନାହିଁ। ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",

  "admin.compareOriginal": "ପୂର୍ବର",
  "admin.compareCleanup": "ସଫା ପ୍ରମାଣ",
  "admin.rejectReason": "ପ୍ରତ୍ୟାଖ୍ୟାନର କାରଣ",
  "admin.loadMore": "ଅଧିକ ଦେଖନ୍ତୁ",
  "admin.kbdHints": "j/k ଚାଳନ - a ସ୍ୱୀକୃତି - r ପ୍ରତ୍ୟାଖ୍ୟାନ"
};

const dictionaries: Record<Lang, Dictionary> = { en, or };

function detectDefaultLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "or") return stored;
  } catch {
    /* storage unavailable */
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.toLowerCase().startsWith("or")) {
      return "or";
    }
  } catch {
    /* navigator unavailable */
  }
  return "en";
}

let currentLang: Lang = detectDefaultLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  try {
    document.documentElement.lang = lang;
  } catch {
    /* document unavailable */
  }
  listeners.forEach((listener) => listener());
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const template = dictionaries[currentLang][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang);
  return [lang, setLang];
}
