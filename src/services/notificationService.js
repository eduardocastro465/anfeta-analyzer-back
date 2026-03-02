// src/services/notificationService.js
class NotificationService {
  constructor(io) {
    this.io = io;
    this.notificationHistory = new Map();
    // Límite para evitar crecimiento infinito del Map
    this.maxHistoryPerUser = 100; 
  }

  // Enviar notificación a un usuario específico
  async sendToUser(email, notification) {
    try {
      // Validar email
      if (!email || typeof email !== 'string') {
        throw new Error('Email inválido');
      }

      const notificationData = {
        id: this.generateId(),
        ...notification,
        timestamp: new Date().toISOString(),
        read: false
      };

      // Guardar en historial con límite
      if (!this.notificationHistory.has(email)) {
        this.notificationHistory.set(email, []);
      }
      
      const userHistory = this.notificationHistory.get(email);
      userHistory.push(notificationData);
      
      // Mantener solo las últimas N notificaciones
      if (userHistory.length > this.maxHistoryPerUser) {
        userHistory.shift(); // Eliminar la más antigua
      }

      // Verificar que el socket existe antes de emitir
      if (this.io && this.io.to) {
        this.io.to(`usuario:${email}`).emit('notificacion', notificationData);
      } else {
        console.warn('Socket.io no disponible');
      }
      
      return notificationData;
    } catch (error) {
      console.error('Error enviando notificacion:', error);
      // No lanzar el error para no interrumpir el flujo principal
      return null;
    }
  }

  // Enviar notificación a múltiples usuarios
  async sendToMany(emails, notification) {
    if (!Array.isArray(emails)) {
      emails = [emails]; // Si es un solo email, convertirlo en array
    }

    const results = [];
    for (const email of emails) {
      try {
        const result = await this.sendToUser(email, notification);
        results.push({ email, success: true, notification: result });
      } catch (error) {
        results.push({ email, success: false, error: error.message });
      }
    }
    return results;
  }

  // Enviar notificación a todos los usuarios conectados
  broadcastNotification(notification, exceptUsers = []) {
    try {
      const notificationData = {
        id: this.generateId(),
        ...notification,
        timestamp: new Date().toISOString(),
        broadcast: true
      };

      if (exceptUsers.length > 0) {
        // Convertir emails a salas
        const exceptRooms = exceptUsers.map(email => `usuario:${email}`);
        this.io.except(exceptRooms).emit('broadcast', notificationData);
      } else {
        this.io.emit('broadcast', notificationData);
      }

      return notificationData;
    } catch (error) {
      console.error('Error en broadcast:', error);
      return null;
    }
  }

  // Marcar notificación como leída
  markAsRead(email, notificationId) {
    try {
      const userNotifications = this.notificationHistory.get(email);
      if (userNotifications) {
        const notification = userNotifications.find(n => n.id === notificationId);
        if (notification) {
          notification.read = true;
          notification.readAt = new Date().toISOString();
          
          this.io.to(`usuario:${email}`).emit('notificacion-leida', notificationId);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Error marcando notificacion como leida:', error);
      return false;
    }
  }

  // Obtener historial de notificaciones de un usuario
  getUserNotifications(email, onlyUnread = false) {
    try {
      const notifications = this.notificationHistory.get(email) || [];
      if (onlyUnread) {
        return notifications.filter(n => !n.read);
      }
      // Devolver copia para evitar modificaciones accidentales
      return [...notifications];
    } catch (error) {
      console.error('Error obteniendo notificaciones:', error);
      return [];
    }
  }

  // Eliminar notificaciones de un usuario
  clearUserNotifications(email) {
    try {
      this.notificationHistory.delete(email);
      return true;
    } catch (error) {
      console.error('Error limpiando notificaciones:', error);
      return false;
    }
  }

  // Obtener conteo de no leídas
  getUnreadCount(email) {
    try {
      const notifications = this.notificationHistory.get(email) || [];
      return notifications.filter(n => !n.read).length;
    } catch (error) {
      console.error('Error obteniendo conteo:', error);
      return 0;
    }
  }

  // Generar ID único
  generateId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${process.pid}`;
  }

  // Tipos de notificaciones predefinidas
  createNotification(type, data) {
    const validTypes = ['success', 'error', 'warning', 'info', 'alerta', 'mensaje', 'sistema'];
    const finalType = validTypes.includes(type) ? type : 'info';
    
    const baseNotification = {
      type: finalType,
      data,
      icon: this.getIconForType(finalType),
      color: this.getColorForType(finalType)
    };

    return baseNotification;
  }

  getIconForType(type) {
    const icons = {
      'success': '✓',
      'error': '✗',
      'warning': '⚠',
      'info': 'ℹ',
      'alerta': '🔔',
      'mensaje': '💬',
      'sistema': '⚙'
    };
    return icons[type] || '•';
  }

  getColorForType(type) {
    const colors = {
      'success': '#10b981', // verde
      'error': '#ef4444',   // rojo
      'warning': '#f59e0b', // naranja
      'info': '#3b82f6',    // azul
      'alerta': '#8b5cf6',  // morado
      'mensaje': '#14b8a6', // verde azulado
      'sistema': '#6b7280'  // gris
    };
    return colors[type] || '#3b82f6';
  }

  // Método para limpiar historial antiguo (útil para memoria)
  cleanupOldNotifications(daysOld = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      for (const [email, notifications] of this.notificationHistory.entries()) {
        const filtered = notifications.filter(n => 
          new Date(n.timestamp) > cutoffDate
        );
        this.notificationHistory.set(email, filtered);
      }
      console.log(`Limpieza completada: notificaciones anteriores a ${daysOld} días eliminadas`);
    } catch (error) {
      console.error('Error en limpieza:', error);
    }
  }
}

export default NotificationService;