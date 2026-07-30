import 'dotenv/config';

import app from './app.js';
import { startAccountRetentionCleanup } from './services/accountLifecycle.service.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

startAccountRetentionCleanup();
