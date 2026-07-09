import express from 'express';
import cors from 'cors';
import itemsRouter from './api/items.js';
import feedbackRouter from './api/feedback.js';
import exportRouter from './api/export.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// 路由
app.use('/api/items', itemsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/export', exportRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 API endpoints:`);
  console.log(`   GET  /api/items`);
  console.log(`   POST /api/feedback`);
  console.log(`   POST /api/export`);
});
