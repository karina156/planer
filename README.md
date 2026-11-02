# Планер

Личный планер: дела, дедлайны с разбивкой на блоки, привычки, сон и энергия, бюджет, колесо баланса.

Сайт: https://karina156.github.io/planer/ · английский: https://karina156.github.io/angl/

Без входа страница пустая. Данные появляются только после входа через Google и хранятся в Firebase (Firestore, `users/{uid}/data/planer`). Правила базы в `firestore.rules`: каждый вошедший читает и пишет только свои документы.

Настройка: вставить `firebaseConfig` из Firebase Console в `firebase-config.js`.
