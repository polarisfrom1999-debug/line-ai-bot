require('dotenv').config();

const REQUIRED_ENV = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'GEMINI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function getEnv() {
  const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (missingEnv.length > 0) {
    throw new Error(`Missing environment variables: ${missingEnv.join(', ')}`);
  }

  return {
    PORT: Number(process.env.PORT || 10000),
    TZ: process.env.APP_TIMEZONE || 'Asia/Tokyo',

    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,

    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash',

    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.4-mini',

    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

module.exports = {
  REQUIRED_ENV,
  getEnv,
};
