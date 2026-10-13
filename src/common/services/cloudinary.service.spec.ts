import { PassThrough } from 'node:stream';
import { Logger } from '@nestjs/common';
import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiResponse,
} from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';
import config from '../config/app.config';

jest.mock('../config/app.config', () => ({
  __esModule: true,
  default: {
    cloudinary_cloud_name: 'test',
    cloudinary_api_key: 'test',
    cloudinary_api_secret: 'test',
  },
}));
jest.mock('cloudinary', () => ({
  v2: { config: jest.fn(), uploader: { upload_stream: jest.fn() } },
}));

describe('Cloudinary upload error handling', () => {
  const uploadStream = cloudinary.uploader
    .upload_stream as unknown as jest.Mock<
    PassThrough,
    [
      unknown,
      ((error?: UploadApiErrorResponse, response?: UploadApiResponse) => void)?,
    ]
  >;
  let logError: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns an HTTPS provider result and bounds the SDK timeout', async () => {
    uploadStream.mockImplementation((_options, callback) => {
      callback?.(undefined, {
        secure_url: 'https://res.cloudinary.com/test/image/upload/photo.jpg',
        public_id: 'test/photo',
      } as UploadApiResponse);
      return new PassThrough();
    });
    await expect(
      new CloudinaryService().uploadImage(Buffer.from('image')),
    ).resolves.toMatchObject({ publicId: 'test/photo' });
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60000 }),
      expect.any(Function),
    );
  });

  it('keeps provider credentials and raw error messages out of client errors', async () => {
    uploadStream.mockImplementation((_options, callback) => {
      callback?.({
        message: 'credential-in-provider-error',
        http_code: 401,
      });
      return new PassThrough();
    });
    await expect(
      new CloudinaryService().uploadImage(Buffer.from('image')),
    ).rejects.toThrow('Image upload failed. Try again');
    expect(logError).toHaveBeenCalledWith('Cloudinary image upload failed', {
      httpCode: 401,
    });
  });

  it('reports missing configuration before attempting an upload', async () => {
    const previous = config.cloudinary_cloud_name;
    config.cloudinary_cloud_name = '';
    try {
      await expect(
        new CloudinaryService().uploadImage(Buffer.from('image')),
      ).rejects.toThrow('Image uploads are unavailable');
      expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    } finally {
      config.cloudinary_cloud_name = previous;
    }
  });
});
