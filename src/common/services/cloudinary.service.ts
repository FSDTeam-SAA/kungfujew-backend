import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import config from '../config/app.config';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  constructor() {
    cloudinary.config({
      cloud_name: config.cloudinary_cloud_name,
      api_key: config.cloudinary_api_key,
      api_secret: config.cloudinary_api_secret,
    });
  }

  async uploadImage(
    fileBuffer: Buffer,
    folder = 'business-gallery',
  ): Promise<{ url: string; publicId: string }> {
    if (
      !config.cloudinary_cloud_name ||
      !config.cloudinary_api_key ||
      !config.cloudinary_api_secret
    ) {
      this.logger.error('Cloudinary configuration is incomplete');
      throw new ServiceUnavailableException(
        'Image uploads are unavailable. Contact an administrator.',
      );
    }
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: 'image',
            timeout: 60000,
          },
          (error, uploaded) => {
            if (error) {
              reject(
                Object.assign(new Error('Cloudinary rejected the upload'), {
                  http_code: error.http_code,
                }),
              );
              return;
            }
            if (!uploaded) {
              reject(new Error('Cloudinary returned no upload result'));
              return;
            }
            resolve(uploaded);
          },
        );
        stream.on('error', reject);
        stream.end(fileBuffer);
      });

      if (
        !result.secure_url ||
        new URL(result.secure_url).protocol !== 'https:' ||
        !result.public_id
      )
        throw new Error('Invalid upload response');
      return {
        url: result.secure_url,
        publicId: result.public_id,
      };
    } catch (error: unknown) {
      const httpCode =
        error &&
        typeof error === 'object' &&
        'http_code' in error &&
        typeof error.http_code === 'number'
          ? error.http_code
          : undefined;
      this.logger.error('Cloudinary image upload failed', { httpCode });
      throw new BadGatewayException(
        'Image upload failed. Try again or contact an administrator.',
      );
    }
  }

  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });
  }
}
