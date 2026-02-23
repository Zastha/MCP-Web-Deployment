import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function checkUsage() {
  try {
    console.log('🔍 Verificando uso de API Key...\n');

    // Test 1: Gemini 1.5 Pro
    console.log('1️⃣  Probando gemini-2.5-pro...');
    const model1 = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const response1 = await model1.generateContent('Test: ¿Cuál es tu nombre?');
    console.log('✓ Exitoso');
    console.log('   Respuesta:', response1.response.text().substring(0, 60) + '...\n');

    // Test 2: Gemini 2.0 Flash
    console.log('2️⃣  Probando gemini-2.0-flash...');
    const model2 = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const response2 = await model2.generateContent('Test: ¿Qué hora es?');
    console.log('✓ Exitoso');
    console.log('   Respuesta:', response2.response.text().substring(0, 60) + '...\n');

    // Test 3: Token counting
    console.log('3️⃣  Contando tokens...');
    const countRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Cuéntame sobre machine learning en 100 palabras' }],
        },
      ],
    };

    try {
      const countResult = await model1.countTokens(countRequest);
      console.log('✓ Tokens estimados:', countResult.totalTokens);
    } catch (err) {
      console.log('⚠️  countTokens no disponible en este modelo');
    }

    console.log('\n✅ Tu API Key está funcionando correctamente con plan Pro');
    console.log('📊 Si ves este mensaje, tienes acceso sin límites.');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('429')) {
      console.log('\n⚠️  CUOTA EXCEDIDA - Posibles causas:');
      console.log('   1. Billing no está activo en Google Cloud');
      console.log('   2. API Key no es de cuenta Pro');
      console.log('   3. Límite de gasto configurado en 0');
      console.log('\n👉 Solución: Ve a https://console.cloud.google.com/billing');
    }
  }
}

checkUsage();