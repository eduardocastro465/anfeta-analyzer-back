// src/middlewares/notificationMiddleware.js
export const notificarOperacion = (tipo, getMensaje) => {
  return async (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(data) {
      setImmediate(async () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const { notificationService } = req;
            const usuario = req.user || req.body.email || data.usuario;
            
            if (usuario && notificationService) {
              const notification = notificationService.createNotification(tipo, {
                titulo: getMensaje(data),
                mensaje: 'Operacion completada exitosamente',
                detalles: data,
                ruta: req.originalUrl,
                metodo: req.method
              });
              
              await notificationService.sendToUser(usuario, notification);
            }
          }
        } catch (error) {
          console.error('Error en notificacion:', error);
        }
      });
      
      return originalJson.call(this, data);
    };
    
    next();
  };
};