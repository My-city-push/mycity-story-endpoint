process.env.MARKET_DELTA_CAMPAIGN_JSON = JSON.stringify({
  recipientUserId: "649465",
  vehicle: "2018 Nissan Altima",
  family: "maintenance_preventive",
  topic: "scheduled_service_vs_lost_day",
  expectedIntentType: "service_interest",
  hypothesis: "A high-use rideshare sedan driver may respond more strongly to scheduled preventive maintenance when it is framed as protecting a full workday rather than simply following a maintenance checklist.",
  title: "El mantenimiento que puedes programar cuesta menos tiempo que el que te obliga a parar",
  caption: "Cuando el carro forma parte de tu ingreso, una reparación inesperada no solo cuesta piezas y mano de obra: también puede quitarte horas o un día completo de trabajo.\n\nEn un sedán de uso frecuente, revisar a tiempo frenos, llantas, fluidos y señales pequeñas de desgaste ayuda a convertir problemas imprevistos en decisiones que puedes planificar.\n\nLa idea no es cambiar piezas antes de tiempo. Es detectar qué necesita atención antes de que el carro decida el horario por ti.\n\n¿Te preocupa más el costo del servicio o perder un día de trabajo?",
  triggerType: "inspection_mileage_updated",
  sourceFingerprint: "garage_649465_inspection_mileage_updated_2026-09-24T15:17:04.595Z",
  editorialFingerprint: "market_v5_649465_2018_nissan_altima_scheduled_service_vs_lost_day",
  visualTheme: "planned_maintenance_protect_workday",
  visualPrompt: "Crear una portada editorial horizontal 1.91:1 para MyCity / Cart Ready. Tema: mantenimiento preventivo y protección del tiempo productivo. Mensaje central: el mantenimiento que puedes programar es mejor que una falla que te obliga a perder un día de trabajo. Vehículo de referencia: 2018 Nissan Altima solo si puede representarse fielmente; de lo contrario usar una composición limpia de sedán de trabajo con elementos sutiles de revisión preventiva, llanta, freno y fluidos, sin logos ni modelo identificable. Estilo minimalista, moderno, alto contraste, fondo blanco o blanco roto, sin personas, sin placas legibles, sin VIN, sin logos grandes. Sin texto o máximo una frase muy corta.",
  coverSourceUrl: ""
});
await import("./market-delta-runner.js");
