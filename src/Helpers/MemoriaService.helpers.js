import Memoria from "../models/MomeriaAi.model.js";
import { smartAICall } from "../libs/aiService.js";

class MemoriaService {

  // ============================================
  // CATEGORÍAS VÁLIDAS (constante de clase)
  // ============================================
  static CATEGORIAS_VALIDAS = ['preferencias', 'personal', 'trabajo', 'habilidades', 'objetivos', 'general', 'conversaciones'];
  static MAX_HISTORIAL = 15;
  static LONGITUD_MINIMA_INFO = 10;
  static UMBRAL_SIMILITUD = 0.85; // 85% de similitud = duplicado

  // ============================================
  // CREAR MEMORIA (optimizado con mejor anti-duplicados)
  // ============================================
  async crear({ odooUserId, email, categoria, informacion, relevancia }) {
    try {
      // Validación temprana
      if (!odooUserId || !informacion || informacion.trim().length < 5) {
        return { success: false, error: 'Datos insuficientes' };
      }

      // Normalizar categoría
      categoria = MemoriaService.CATEGORIAS_VALIDAS.includes(categoria)
        ? categoria
        : 'general';

      const infoNormalizada = this._normalizarTexto(informacion);

      // Validar longitud mínima después de normalizar
      if (infoNormalizada.length < MemoriaService.LONGITUD_MINIMA_INFO) {
        return { success: false, error: 'Información demasiado corta' };
      }

      let memoria = await Memoria.findOne({ odooUserId });

      // Si no existe, crear
      if (!memoria) {
        memoria = await Memoria.create({
          odooUserId,
          email,
          memorias: this._crearMemoriasVacias(),
          relevancia: relevancia || 0.5
        });

      }

      // Verificación avanzada de duplicados
      const resultado = this._verificarDuplicado(
        memoria.memorias[categoria],
        infoNormalizada
      );

      if (resultado.esDuplicado) {


        // Actualización atómica para incrementar relevancia
        await Memoria.findOneAndUpdate(
          { odooUserId },
          {
            $set: { ultimoAcceso: new Date() },
            $inc: { relevancia: 0.05 }
          }
        );

        return {
          success: true,
          duplicado: true,
          similitud: resultado.similitud,
          textoExistente: resultado.textoExistente
        };
      }

      // Agregar nueva información (actualización atómica)
      await Memoria.findOneAndUpdate(
        { odooUserId },
        {
          $push: { [`memorias.${categoria}`]: infoNormalizada },
          $set: {
            ultimoAcceso: new Date(),
            relevancia: Math.max(memoria.relevancia, relevancia || 0.7)
          }
        }
      );


      return { success: true, agregado: true };

    } catch (error) {

      return { success: false, error: error.message };
    }
  }

  // ============================================
  // OBTENER RELEVANTES (optimizado con caché)
  // ============================================
  async obtenerRelevantes(odooUserId, consulta, limite = 5) {
    try {
      // Proyección: solo traer campos necesarios
      const memoria = await Memoria.findOne(
        { odooUserId, activa: true },
        'memorias relevancia'
      ).lean(); // .lean() para objetos planos (más rápido)

      if (!memoria) return [];

      const palabras = this._extraerPalabrasClaves(consulta);

      if (palabras.length === 0) {
        // Actualización sin recargar documento
        await this._actualizarAcceso(odooUserId);
        return [memoria];
      }

      // Búsqueda optimizada
      const resultados = this._buscarCoincidencias(memoria.memorias, palabras, memoria.relevancia);

      if (resultados.length > 0) {
        await this._actualizarAcceso(odooUserId);
      }


      return resultados.slice(0, limite);

    } catch (error) {

      return [];
    }
  }

  // ============================================
  // GENERAR CONTEXTO PARA IA (optimizado)
  // ============================================
  async generarContextoIA(odooUserId, mensajeActual = '') {
    try {
      // Solo traer campos necesarios
      const memoria = await Memoria.findOne(
        { odooUserId, activa: true },
        'memorias'
      ).lean();

      if (!memoria) return '';

      // Actualizar acceso de forma asíncrona (no bloqueante)
      this._actualizarAcceso(odooUserId).catch(err => { });

      // Construcción eficiente del contexto
      const contexto = this._construirContexto(memoria.memorias);

      if (!contexto) return '';


      return `LO QUE SÉ DEL USUARIO:\n${contexto}`;

    } catch (error) {

      return '';
    }
  }

  // ============================================
  // OBTENER ACTIVAS
  // ============================================
  async obtenerActivas(odooUserId, limite = 10) {
    try {
      const memorias = await Memoria.obtenerActivas(odooUserId, limite);

      if (memorias.length > 0) {
        // Actualización en bulk
        await Memoria.updateMany(
          { _id: { $in: memorias.map(m => m._id) } },
          {
            $set: { ultimoAcceso: new Date() },
            $inc: { vecesAccedida: 1 }
          }
        );
      }

      return { success: true, memorias };
    } catch (error) {

      return { success: false, memorias: [] };
    }
  }

  // ============================================
  // EXTRAER CON IA (optimizado)
  // ============================================
  async extraerConIA(odooUserId, email, mensajeUsuario, respuestaIA) {
    try {
      // Validación temprana
      if (!mensajeUsuario || mensajeUsuario.length < 5) {
        return { success: true, cantidad: 0 };
      }

      const prompt = this._construirPromptExtraccion(mensajeUsuario, respuestaIA);

      const resultado = await smartAICall(prompt);
      const data = this._parsearRespuestaIA(resultado.text);

      if (!data?.hayMemoria || !Array.isArray(data.memorias)) {
        return { success: true, cantidad: 0 };
      }

      // Guardar en paralelo (más rápido) con contadores
      let agregadas = 0;
      let duplicadas = 0;

      const promesas = data.memorias.map(async mem => {
        const resultado = await this.crear({
          odooUserId,
          email,
          categoria: mem.categoria || 'general',
          informacion: mem.informacion,
          relevancia: mem.relevancia || 0.7
        });

        if (resultado.agregado) agregadas++;
        if (resultado.duplicado) duplicadas++;

        return resultado;
      });

      await Promise.all(promesas);


      return {
        success: true,
        cantidad: agregadas,
        duplicados: duplicadas
      };

    } catch (error) {

      return { success: false };
    }
  }

  // ============================================
  // AGREGAR HISTORIAL (optimizado)
  // ============================================
  async agregarHistorial(odooUserId, tipo, resumen) {
    try {
      // Validación
      if (!['usuario', 'ia'].includes(tipo)) {
        return { success: false, mensaje: 'Tipo inválido' };
      }

      // Limitar longitud del resumen
      const resumenLimitado = resumen.length > 200
        ? resumen.substring(0, 200) + '...'
        : resumen;

      // Actualización atómica con $push y $slice
      const resultado = await Memoria.findOneAndUpdate(
        { odooUserId },
        {
          $push: {
            historialConversaciones: {
              $each: [{
                ia: tipo,
                resumenConversacion: resumenLimitado,
                timestamp: new Date()
              }],
              $slice: -MemoriaService.MAX_HISTORIAL // Mantener solo últimos 50
            }
          }
        },
        { new: true }
      );

      if (!resultado) {
        return { success: false, mensaje: 'Usuario no encontrado' };
      }

      return { success: true };

    } catch (error) {

      return { success: false, error: error.message };
    }
  }

  // ============================================
  // OBTENER HISTORIAL (con caché)
  // ============================================
  async obtenerHistorial(odooUserId, limite = 20) {
    try {
      const memoria = await Memoria.findOne(
        { odooUserId },
        { historialConversaciones: { $slice: -limite } }
      ).lean();

      if (!memoria) {
        return { success: false, historial: [] };
      }

      return {
        success: true,
        historial: memoria.historialConversaciones.reverse()
      };

    } catch (error) {

      return { success: false, historial: [] };
    }
  }

  // ============================================
  // DEGRADAR RELEVANCIA (optimizado)
  // ============================================
  async degradarRelevancia(diasSinUso = 30) {
    try {
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - diasSinUso);

      const resultado = await Memoria.updateMany(
        {
          ultimoAcceso: { $lt: fechaLimite },
          relevancia: { $gt: 0.1 },
          activa: true
        },
        { $mul: { relevancia: 0.9 } }
      );


      return { success: true, modificadas: resultado.modifiedCount };

    } catch (error) {

      return { success: false };
    }
  }

  // ============================================
  // DESACTIVAR/REACTIVAR (combinado)
  // ============================================
  async toggleActiva(odooUserId, activa = false) {
    try {
      const resultado = await Memoria.findOneAndUpdate(
        { odooUserId },
        { activa },
        { new: true }
      );

      if (!resultado) {
        return { success: false, mensaje: 'Usuario no encontrado' };
      }


      return { success: true };
    } catch (error) {

      return { success: false };
    }
  }

  // Wrapper para mantener compatibilidad
  async desactivar(odooUserId) {
    return this.toggleActiva(odooUserId, false);
  }

  async reactivar(odooUserId) {
    return this.toggleActiva(odooUserId, true);
  }

  // ============================================
  // LIMPIAR (optimizado)
  // ============================================
  async limpiar(odooUserId, categoria = null) {
    try {
      const memoria = await Memoria.findOne({ odooUserId });

      if (!memoria) {
        return { success: false, mensaje: 'Usuario no encontrado' };
      }

      if (categoria) {
        if (!MemoriaService.CATEGORIAS_VALIDAS.includes(categoria)) {
          return { success: false, mensaje: 'Categoría inválida' };
        }

        // Actualización atómica
        await Memoria.findOneAndUpdate(
          { odooUserId },
          { $set: { [`memorias.${categoria}`]: [] } }
        );


        return { success: true, mensaje: `Categoría ${categoria} limpiada` };
      }

      // Eliminar todo
      await Memoria.deleteOne({ odooUserId });

      return { success: true, mensaje: 'Memorias eliminadas' };

    } catch (error) {

      return { success: false, error: error.message };
    }
  }

  // ============================================
  // LIMPIAR DUPLICADOS (NUEVO)
  // ============================================
  async limpiarDuplicados(odooUserId) {
    try {
      const memoria = await Memoria.findOne({ odooUserId });

      if (!memoria) {
        return { success: false, mensaje: 'Usuario no encontrado' };
      }

      let totalEliminados = 0;
      const memoriasLimpias = {};

      // Procesar cada categoría
      for (const [categoria, items] of Object.entries(memoria.memorias)) {
        if (!Array.isArray(items)) {
          memoriasLimpias[categoria] = items;
          continue;
        }

        const unicos = this._eliminarDuplicadosArray(items);
        const eliminados = items.length - unicos.length;

        memoriasLimpias[categoria] = unicos;
        totalEliminados += eliminados;

        if (eliminados > 0) {

        }
      }

      // Actualizar documento
      await Memoria.findOneAndUpdate(
        { odooUserId },
        { $set: { memorias: memoriasLimpias } }
      );


      return {
        success: true,
        eliminados: totalEliminados
      };

    } catch (error) {

      return { success: false, error: error.message };
    }
  }

  // ============================================
  // LIMPIAR HISTORIAL (optimizado)
  // ============================================
  async limpiarHistorial(odooUserId) {
    try {
      const resultado = await Memoria.findOneAndUpdate(
        { odooUserId },
        { $set: { historialConversaciones: [] } }
      );

      if (!resultado) {
        return { success: false, mensaje: 'Usuario no encontrado' };
      }


      return { success: true };

    } catch (error) {

      return { success: false, error: error.message };
    }
  }

  // ============================================
  // ESTADÍSTICAS (optimizado)
  // ============================================
  async obtenerEstadisticas(odooUserId) {
    try {
      const memoria = await Memoria.findOne({ odooUserId }).lean();

      if (!memoria) {
        return { success: false, stats: null };
      }

      const porCategoria = {};
      let totalItems = 0;

      for (const [categoria, items] of Object.entries(memoria.memorias)) {
        const count = Array.isArray(items) ? items.length : 0;
        porCategoria[categoria] = count;
        totalItems += count;
      }

      return {
        success: true,
        stats: {
          totalItems,
          porCategoria,
          relevancia: memoria.relevancia,
          vecesAccedida: memoria.vecesAccedida,
          ultimoAcceso: memoria.ultimoAcceso,
          activa: memoria.activa,
          totalConversaciones: memoria.historialConversaciones?.length || 0,
          creado: memoria.createdAt,
          actualizado: memoria.updatedAt
        }
      };

    } catch (error) {

      return { success: false, stats: null };
    }
  }

  // ============================================
  // MÉTODOS HELPER PRIVADOS
  // ============================================

  _crearMemoriasVacias() {
    return Object.fromEntries(
      MemoriaService.CATEGORIAS_VALIDAS.map(cat => [cat, []])
    );
  }

  /**
   * Normaliza texto eliminando caracteres especiales, espacios extra, etc.
   */
  _normalizarTexto(texto) {
    return texto
      .trim()
      .replace(/\s+/g, ' ') // Espacios múltiples a uno
      .replace(/[.;,]+$/g, '') // Puntuación final
      .toLowerCase();
  }

  /**
   * Calcula similitud de Jaccard entre dos textos
   */
  _calcularSimilitud(texto1, texto2) {
    const palabras1 = new Set(texto1.toLowerCase().split(/\s+/).filter(p => p.length > 2));
    const palabras2 = new Set(texto2.toLowerCase().split(/\s+/).filter(p => p.length > 2));

    const interseccion = new Set([...palabras1].filter(p => palabras2.has(p)));
    const union = new Set([...palabras1, ...palabras2]);

    if (union.size === 0) return 0;

    return interseccion.size / union.size;
  }

  /**
   * Calcula distancia de Levenshtein normalizada (0 = idéntico, 1 = totalmente diferente)
   */
  _distanciaLevenshtein(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 0;

    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));

    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;

    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    const distancia = matrix[len2][len1];
    return 1 - (distancia / maxLen); // Normalizado: 1 = idéntico
  }

  /**
   * Verifica si un texto es duplicado usando múltiples métricas
   */
  _verificarDuplicado(items, textoNuevo) {
    if (!Array.isArray(items) || items.length === 0) {
      return { esDuplicado: false };
    }

    const textoNuevoNorm = this._normalizarTexto(textoNuevo);

    for (const item of items) {
      const itemNorm = this._normalizarTexto(item);

      // 1. Comparación exacta
      if (itemNorm === textoNuevoNorm) {
        return {
          esDuplicado: true,
          similitud: 1.0,
          textoExistente: item
        };
      }

      // 2. Uno contiene al otro (substring)
      if (itemNorm.includes(textoNuevoNorm) || textoNuevoNorm.includes(itemNorm)) {
        const similitud = Math.min(textoNuevoNorm.length, itemNorm.length) /
          Math.max(textoNuevoNorm.length, itemNorm.length);

        if (similitud >= MemoriaService.UMBRAL_SIMILITUD) {
          return {
            esDuplicado: true,
            similitud,
            textoExistente: item
          };
        }
      }

      // 3. Similitud de Jaccard (palabras comunes)
      const similitudJaccard = this._calcularSimilitud(itemNorm, textoNuevoNorm);

      if (similitudJaccard >= MemoriaService.UMBRAL_SIMILITUD) {
        return {
          esDuplicado: true,
          similitud: similitudJaccard,
          textoExistente: item
        };
      }

      // 4. Distancia de Levenshtein (para textos cortos)
      if (itemNorm.length < 100 && textoNuevoNorm.length < 100) {
        const similitudLevenshtein = this._distanciaLevenshtein(itemNorm, textoNuevoNorm);

        if (similitudLevenshtein >= MemoriaService.UMBRAL_SIMILITUD) {
          return {
            esDuplicado: true,
            similitud: similitudLevenshtein,
            textoExistente: item
          };
        }
      }
    }

    return { esDuplicado: false };
  }

  /**
   * Elimina duplicados de un array usando las mismas métricas
   */
  _eliminarDuplicadosArray(items) {
    if (!Array.isArray(items) || items.length === 0) return items;

    const unicos = [];

    for (const item of items) {
      const resultado = this._verificarDuplicado(unicos, item);

      if (!resultado.esDuplicado) {
        unicos.push(item);
      }
    }

    return unicos;
  }

  _extraerPalabrasClaves(consulta) {
    return consulta
      .toLowerCase()
      .split(/\s+/)
      .filter(p => p.length > 2);
  }

  _buscarCoincidencias(memorias, palabras, relevancia) {
    const resultados = [];

    for (const [categoria, items] of Object.entries(memorias)) {
      if (!Array.isArray(items)) continue;

      items.forEach(item => {
        const itemLower = item.toLowerCase();
        const coincidencias = palabras.filter(p => itemLower.includes(p)).length;

        if (coincidencias > 0) {
          resultados.push({
            categoria,
            informacion: item,
            relevancia,
            coincidencias
          });
        }
      });
    }

    return resultados.sort((a, b) => b.coincidencias - a.coincidencias);
  }

  _construirContexto(memorias) {
    const lineas = [];

    for (const [categoria, items] of Object.entries(memorias)) {
      if (Array.isArray(items) && items.length > 0) {
        lineas.push(`${categoria.toUpperCase()}: ${items.join('; ')}`);
      }
    }

    return lineas.join('\n');
  }

  _construirPromptExtraccion(mensajeUsuario, respuestaIA) {
    return `Analiza esta conversación y extrae información memorable del usuario.

CONVERSACIÓN:
Usuario: "${mensajeUsuario}"
Asistente: "${respuestaIA}"

EXTRAE información si el usuario menciona:
- Preferencias personales (me gusta, prefiero, odio, amo)
- Información personal (nombre, edad, ubicación, familia)
- Contexto laboral (empresa, puesto, equipo, proyectos)
- Habilidades (sé hacer, conozco, domino, he trabajado con)
- Objetivos o metas (quiero, planeo, mi meta es)

CONSOLIDAR: Agrupa múltiples items de la misma categoría.

NO extraigas: preguntas genéricas, saludos, info temporal.

Responde en JSON (sin markdown):
{
  "hayMemoria": true/false,
  "memorias": [
    {
      "categoria": "preferencias|personal|trabajo|habilidades|objetivos|general|conversaciones",
      "informacion": "texto conciso",
      "relevancia": 0.1-1.0
    }
  ]
}`;
  }

  _parsearRespuestaIA(texto) {
    try {
      let limpio = texto.trim();

      if (limpio.includes('```')) {
        limpio = limpio.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }

      return parseAIJSONSafe(limpio);
    } catch (error) {

      return null;
    }
  }

  async _actualizarAcceso(odooUserId) {
    return Memoria.findOneAndUpdate(
      { odooUserId },
      {
        $set: { ultimoAcceso: new Date() },
        $inc: { vecesAccedida: 1 }
      }
    );
  }
}

export default new MemoriaService();