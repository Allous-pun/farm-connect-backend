const Listing = require('../models/Listing');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// For production, you'd use cloud storage (AWS S3, Cloudinary, etc.)
// For now, we'll implement local storage with a note about cloud migration

// @desc    Upload listing images
// @route   POST /api/listings/:id/images
// @access  Private
exports.uploadImages = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload images for this listing'
      });
    }

    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    // Check maximum images (4)
    const currentImageCount = listing.images.length;
    const newImageCount = req.files.length;
    
    if (currentImageCount + newImageCount > 4) {
      return res.status(400).json({
        success: false,
        message: `Maximum 4 images allowed. You have ${currentImageCount} images and trying to add ${newImageCount}.`
      });
    }

    const uploadedImages = [];

    // Process each uploaded file
    for (const file of req.files) {
      // Generate unique filename
      const fileExt = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExt}`;
      
      // In production, upload to cloud storage here
      // For now, we'll simulate by storing file info
      
      const imageData = {
        url: `/uploads/listings/${fileName}`, // This would be cloud URL in production
        thumbnailUrl: `/uploads/listings/thumbnails/${fileName}`, // Generate thumbnail
        caption: Array.isArray(req.body.captions) ? req.body.captions[uploadedImages.length] || '' : req.body.captions || '',
        isPrimary: currentImageCount === 0 && uploadedImages.length === 0,
        order: currentImageCount + uploadedImages.length
      };

      uploadedImages.push(imageData);
    }

    // Add images to listing
    listing.images.push(...uploadedImages);
    await listing.save();

    res.status(201).json({
      success: true,
      message: `${uploadedImages.length} image(s) uploaded successfully`,
      data: {
        listingId: listing._id,
        images: uploadedImages,
        totalImages: listing.images.length
      }
    });

  } catch (error) {
    console.error('Upload images error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading images',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Remove listing image
// @route   DELETE /api/listings/:id/images/:imageIndex
// @access  Private
exports.removeImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params;
    
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to remove images from this listing'
      });
    }

    // Use the model method
    await listing.removeImage(parseInt(imageIndex));

    res.json({
      success: true,
      message: 'Image removed successfully',
      data: {
        listingId: listing._id,
        images: listing.images,
        totalImages: listing.images.length
      }
    });

  } catch (error) {
    console.error('Remove image error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error removing image',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Set primary image
// @route   PUT /api/listings/:id/images/:imageIndex/set-primary
// @access  Private
exports.setPrimaryImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params;
    
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify images for this listing'
      });
    }

    // Use the model method
    await listing.setPrimaryImage(parseInt(imageIndex));

    res.json({
      success: true,
      message: 'Primary image set successfully',
      data: {
        listingId: listing._id,
        primaryImage: listing.images.find(img => img.isPrimary)
      }
    });

  } catch (error) {
    console.error('Set primary image error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error setting primary image',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Reorder listing images
// @route   PUT /api/listings/:id/images/reorder
// @access  Private
exports.reorderImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { order } = req.body; // Array of image indices in new order
    
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify images for this listing'
      });
    }

    // Validate order array
    if (!Array.isArray(order) || order.length !== listing.images.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order array'
      });
    }

    // Reorder images
    const reorderedImages = order.map((newIndex, oldIndex) => {
      return listing.images[newIndex];
    });

    listing.images = reorderedImages;
    
    // Update order property
    listing.images.forEach((img, index) => {
      img.order = index;
    });

    await listing.save();

    res.json({
      success: true,
      message: 'Images reordered successfully',
      data: {
        listingId: listing._id,
        images: listing.images
      }
    });

  } catch (error) {
    console.error('Reorder images error:', error);
    res.status(500).json({
      success: false,
      message: 'Error reordering images',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};