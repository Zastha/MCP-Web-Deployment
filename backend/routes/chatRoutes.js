import express from 'express';
import { sendMessage, getMessageStatus } from '../controllers/chatController.js';
import { validateRequest } from '../middlewares/validateRequest.js';

const router = express.Router();

router.post('/message', validateRequest, sendMessage);
router.get('/status/:requestId', getMessageStatus);

export default router;