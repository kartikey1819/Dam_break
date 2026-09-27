/* UI strings. Add a regional language by adding another object (e.g. bn, mr, ta)
 * with the same keys and listing it in FS.i18n.langs. Missing keys fall back to English. */
window.FS = window.FS || {};
FS.i18n = {
  langs: { en: 'English', hi: 'हिन्दी' },
  en: {
    subtitle: 'Dam Break & Flood Inundation Decision Support System',
    landingDesc: 'Simulate dam-break and sudden water-release scenarios, visualize downstream inundation, compare hydrodynamic models, and support humanitarian disaster-response planning.',
    launchSim: 'Launch Simulation', exploreScenario: 'Explore Scenario', resetDemo: 'Reset Demo',
    nav_dashboard: 'Dashboard', nav_builder: 'Scenario Builder', nav_simulation: 'Flood Simulation', nav_models: 'Model Comparison',
    nav_impact: 'Impact Analysis', nav_nrt: 'Near-Real-Time Analysis', nav_evac: 'Evacuation Intelligence', nav_priority: 'HADR Priority',
    nav_whatif: 'Scenario Comparison', nav_export: 'Export & Reports', nav_data: 'Data Sources', nav_arch: 'System Architecture', nav_settings: 'Settings',
    online: 'ONLINE', offline: 'OFFLINE / CACHED DEMO MODE', demoMode: 'DEMO MODE', data: 'Data', lastSim: 'Last simulation', severity: 'Severity',
    run: 'RUN FLOOD SIMULATION', maxDepth: 'Max flood depth', maxVel: 'Max velocity', firstArrival: 'First arrival (settlement)', area: 'Inundated area',
    villages: 'Affected villages', roads: 'Roads flooded', bridges: 'Bridges at risk', infra: 'Critical infra at risk', population: 'Affected population (est.)',
    highPri: 'High-priority HADR locations', panchayats: 'Affected panchayats', agri: 'Agricultural area (est.)', peakQ: 'Peak discharge',
    alertTitle: 'FLOOD ALERT', village: 'Village', arrival: 'Flood arrival', depth: 'Maximum depth', risk: 'Risk', action: 'Recommended action',
    moveTo: 'Move toward', avoid: 'Avoid', shelter: 'No safe road route before flood arrival. Move immediately to the upper floor of the nearest pucca (multi-storey) building or raised platform and await rescue.',
    minutes: 'minutes', demoAlert: 'DEMO ALERT — simulated scenario, not an official warning.'
  },
  hi: {
    subtitle: 'बाँध टूटना एवं बाढ़ जलप्लावन निर्णय सहायता प्रणाली',
    landingDesc: 'बाँध टूटने और अचानक जल-निकासी परिदृश्यों का अनुकरण करें, निचले क्षेत्रों में जलप्लावन देखें, जल-गतिकीय मॉडलों की तुलना करें और मानवीय आपदा-प्रतिक्रिया योजना में सहायता करें।',
    launchSim: 'सिमुलेशन प्रारंभ करें', exploreScenario: 'परिदृश्य देखें', resetDemo: 'डेमो रीसेट करें',
    nav_dashboard: 'डैशबोर्ड', nav_builder: 'परिदृश्य निर्माता', nav_simulation: 'बाढ़ सिमुलेशन', nav_models: 'मॉडल तुलना',
    nav_impact: 'प्रभाव विश्लेषण', nav_nrt: 'निकट-वास्तविक-समय विश्लेषण', nav_evac: 'निकासी इंटेलिजेंस', nav_priority: 'HADR प्राथमिकता',
    nav_whatif: 'परिदृश्य तुलना', nav_export: 'निर्यात एवं रिपोर्ट', nav_data: 'डेटा स्रोत', nav_arch: 'सिस्टम आर्किटेक्चर', nav_settings: 'सेटिंग्स',
    online: 'ऑनलाइन', offline: 'ऑफ़लाइन / कैश्ड डेमो मोड', demoMode: 'डेमो मोड', data: 'डेटा', lastSim: 'अंतिम सिमुलेशन', severity: 'गंभीरता',
    run: 'बाढ़ सिमुलेशन चलाएँ', maxDepth: 'अधिकतम बाढ़ गहराई', maxVel: 'अधिकतम वेग', firstArrival: 'पहला आगमन (बस्ती)', area: 'जलमग्न क्षेत्र',
    villages: 'प्रभावित गाँव', roads: 'जलमग्न सड़कें', bridges: 'जोखिमग्रस्त पुल', infra: 'जोखिमग्रस्त महत्वपूर्ण अवसंरचना', population: 'प्रभावित जनसंख्या (अनुमानित)',
    highPri: 'उच्च-प्राथमिकता HADR स्थान', panchayats: 'प्रभावित पंचायतें', agri: 'कृषि क्षेत्र (अनुमानित)', peakQ: 'अधिकतम प्रवाह',
    alertTitle: 'बाढ़ चेतावनी', village: 'गाँव', arrival: 'बाढ़ आगमन', depth: 'अधिकतम गहराई', risk: 'जोखिम', action: 'अनुशंसित कार्रवाई',
    moveTo: 'इस ओर जाएँ', avoid: 'इस मार्ग से बचें', shelter: 'बाढ़ से पहले कोई सुरक्षित सड़क मार्ग उपलब्ध नहीं। तुरंत निकटतम पक्के बहुमंज़िला भवन की ऊपरी मंज़िल या ऊँचे स्थान पर जाएँ और बचाव की प्रतीक्षा करें।',
    minutes: 'मिनट', demoAlert: 'डेमो चेतावनी — सिम्युलेटेड परिदृश्य, आधिकारिक चेतावनी नहीं।'
  }
};
FS.t = function (key, lang) {
  const l = lang || (FS.state && FS.state.lang) || 'en';
  return (FS.i18n[l] && FS.i18n[l][key]) || FS.i18n.en[key] || key;
};
