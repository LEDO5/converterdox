import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { promisify } from 'util';
import libre from 'libreoffice-convert';

const convertLibreOffice = promisify(libre.convert);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3571;

// Enable CORS
app.use(cors());

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// Ensure uploads directory exists
await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });

// Handle audio conversion
async function convertAudio(inputPath, outputPath, format) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat(format)
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

// Handle document conversion
async function convertDocument(inputPath, outputPath, targetFormat) {
  const inputBuffer = await fs.readFile(inputPath);
  const outputExtension = `.${targetFormat}`;
  const outputBuffer = await convertLibreOffice(inputBuffer, outputExtension, undefined);
  await fs.writeFile(outputPath, outputBuffer);
}

// Handle image conversion
async function convertImage(inputPath, outputPath, format) {
  const image = sharp(inputPath);
  if (format === 'jpg' || format === 'jpeg') {
    await image.jpeg({ quality: 90 }).toFile(outputPath);
  } else if (format === 'png') {
    await image.png({ quality: 90 }).toFile(outputPath);
  } else if (format === 'webp') {
    await image.webp({ quality: 90 }).toFile(outputPath);
  }
}

// Handle file conversion
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    const { targetFormat } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = file.path;
    const outputFileName = `${Date.now()}-converted.${targetFormat}`;
    const outputPath = path.join(__dirname, 'uploads', outputFileName);

    // Get file extension
    const sourceFormat = path.extname(file.originalname).toLowerCase().slice(1);

    // Validate supported formats
    const supportedAudioFormats = ['mp3', 'wav', 'ogg', 'm4a'];
    const supportedImageFormats = ['jpg', 'jpeg', 'png', 'webp'];
    const supportedDocFormats = ['pdf', 'docx', 'txt'];

    // Set content type mapping
    const contentTypes = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'm4a': 'audio/mp4',
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp'
    };

    // Convert based on target format
    if (supportedAudioFormats.includes(targetFormat)) {
      await convertAudio(inputPath, outputPath, targetFormat);
    } else if (supportedDocFormats.includes(targetFormat)) {
      await convertDocument(inputPath, outputPath, targetFormat);
    } else if (supportedImageFormats.includes(targetFormat)) {
      await convertImage(inputPath, outputPath, targetFormat);
    } else {
      throw new Error(`Conversion to ${targetFormat} is not supported`);
    }

    // Set headers and send file
    res.setHeader('Content-Type', contentTypes[targetFormat]);
    res.setHeader('Content-Disposition', `attachment; filename=${outputFileName}`);
    
    // Stream the file
    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);
    
    // Clean up files after streaming
    fileStream.on('end', async () => {
      try {
        await fs.unlink(inputPath);
        await fs.unlink(outputPath);
      } catch (cleanupError) {
        console.error('Error cleaning up files:', cleanupError);
      }
    });
  } catch (error) {
    // Clean up input file if it exists
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up input file:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      error: error.message || 'Conversion failed',
      details: error.toString()
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});