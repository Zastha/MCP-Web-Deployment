import express from 'express';
import {
  sendMessage,
  getMessageStatus,
  getMessageResult
} from '../controllers/chatController.js';
import { validateRequest } from '../middlewares/validateRequest.js';

const router = express.Router();

// Enviar mensaje — responde inmediatamente con requestId
router.post('/message', validateRequest, sendMessage);

// Polling de progreso — devuelve el paso actual (sin resultado)
router.get('/status/:requestId', getMessageStatus);

// Recoger resultado — llamar una vez cuando status === 'completed'
router.get('/result/:requestId', getMessageResult);

export default router;