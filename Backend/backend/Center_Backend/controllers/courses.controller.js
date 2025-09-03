import Course from '../models/Courses/Courses.models.js';
import  Franchise from '../models/Franchise.model.js'; // Import Franchise model for validation
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"; 
import { asyncHandler } from "../utils/asynchanlder.js";
// Create a new course
export const createCourse = asyncHandler(async (req, res) => {
    try {
        const {
            courseCode, courseName, courseSubject, franchiseId, courseFees, courseMRP,
            courseDuration, // Expected as number (months)
            courseVideoLinks, // Expected as JSON string of [{title, link}]
            courseSyllabus, courseEligibility, byAdmin,adminApprovalStatus,
            instituteStatus // Renamed from status
        } = req.body;

        console.log("Received course creation request with body:", req.body);

        // Get franchiseId from req.user (preferred) or req.body (fallback)
        // let franchiseId = req.user?.franchiseId || req.body.franchiseId;
        
        // If franchiseId is not found, try to get instituteID from req.user
        if (!franchiseId && req.user?.instituteID) {
            franchiseId = req.user.instituteID;
        }

        // Check if course code already exists for this franchise
        const existingCourse = await Course.findOne({ 
            courseCode: courseCode,
            franchiseId:franchiseId
        });

        if (existingCourse) {
            return res.status(400).json({ 
                success: false,
                error: "Course code already exists for this institute." 
            });
        }

        // Upload course image if provided
        let courseImageCloudinaryUrl = '';
        if (req.files && req.files.courseImage && req.files.courseImage[0]) {
            const imageFile = req.files.courseImage[0];
            const uploadedImage = await uploadOnCloudinary(imageFile.path);
            if (uploadedImage && uploadedImage.url) {
                courseImageCloudinaryUrl = uploadedImage.url;
            } else {
                console.error("Cloudinary image upload failed or URL not found", uploadedImage);
                return res.status(500).json({ 
                    success: false,
                    error: "Failed to upload course image. Please try again." 
                });
            }
        } else if (req.file) { // Fallback if sent as req.file (single upload)
            const uploadedImage = await uploadOnCloudinary(req.file.path);
            if (uploadedImage && uploadedImage.url) {
                courseImageCloudinaryUrl = uploadedImage.url;
            } else {
                console.error("Cloudinary image upload failed (req.file) or URL not found", uploadedImage);
                return res.status(500).json({ 
                    success: false,
                    error: "Failed to upload course image. Please try again." 
                });
            }
        }

        // Process course materials
        let processedCourseMaterials = [];
        const courseMaterialsInput = req.body.courseMaterials ? JSON.parse(req.body.courseMaterials) : [];
        let fileUploadIndex = 0;

        for (const material of courseMaterialsInput) {
            if (material.type === 'link') {
                if (material.url && material.title) {
                    processedCourseMaterials.push({
                        title: material.title,
                        type: 'link',
                        url: material.url,
                        fileType: 'external-link',
                    });
                }
            } else if (material.type === 'file') {
                if (material.isNewFile && req.files && req.files.courseMaterialFiles && req.files.courseMaterialFiles[fileUploadIndex]) {
                    const materialFile = req.files.courseMaterialFiles[fileUploadIndex];
                    const uploadedMaterial = await uploadOnCloudinary(materialFile.path);
                    if (uploadedMaterial && uploadedMaterial.url) {
                        processedCourseMaterials.push({
                            title: material.title || materialFile.originalname,
                            type: 'file',
                            url: uploadedMaterial.url,
                            fileName: materialFile.originalname,
                            fileType: materialFile.mimetype,
                            franchiseId,
                        });
                    } else {
                        console.error("Cloudinary material upload failed for file:", materialFile.originalname, uploadedMaterial);
                        // Continue processing other files instead of failing completely
                    }
                    fileUploadIndex++;
                } else if (!material.isNewFile && material.url) {
                    processedCourseMaterials.push(material);
                } else {
                    console.warn("Mismatch or issue with course material file data at index", fileUploadIndex, material);
                }
            }
        }
        
        // Parse JSON string fields
        const parsedCourseVideoLinks = courseVideoLinks ? JSON.parse(courseVideoLinks) : [];

        // Validate required fields
        if (!courseCode || !courseName || !courseSubject || !courseFees || !courseMRP || !courseDuration) {
            return res.status(400).json({ 
                success: false,
                error: "All required fields must be filled." 
            });
        }
console.log(franchiseId, "franchiseId in createCourse");
        // Create new course with franchise information
        const newCourse = new Course({
            courseCode,
            courseName,
            courseSubject,
            franchiseId, // System Generated ID
            courseFees: Number(courseFees),
            courseMRP: Number(courseMRP),
            courseDuration: Number(courseDuration),
            courseVideoLinks: parsedCourseVideoLinks.filter(v => v.title && v.link),
            courseSyllabus,
            courseEligibility,
            courseImage: courseImageCloudinaryUrl,
            courseMaterials: processedCourseMaterials,
            byAdmin: byAdmin || false, // Default to false if not provided
            adminApprovalStatus: adminApprovalStatus, // Default to pending for admin approval
            instituteStatus: instituteStatus || 'active',
            franchiseId:  franchiseId, // Use franchiseId from request
            
        });

        await newCourse.save();

        // Return success response with course details
        res.status(201).json({ 
            success: true,
            message: 'Course created successfully. Pending admin approval.',
            course: {
                ...newCourse.toObject(),
                franchiseInfo: {
                    franchiseId: franchiseId
                }
            }
        });

    } catch (error) {
        console.error("Error creating course:", error);
        
        // Handle specific MongoDB errors
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false,
                error: "Course with this code already exists." 
            });
        }
        
        // Handle validation errors
        if (error.name === 'ValidationError') {
            const validationErrors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ 
                success: false,
                error: "Validation failed: " + validationErrors.join(', ') 
            });
        }
        
        res.status(500).json({ 
            success: false,
            error: "An error occurred while creating the course. Please try again." 
        });
    }
});

// Additional helper function to validate franchise access
export const validateFranchiseAccess = async (franchiseId, courseId = null) => {
    try {
        // Validate franchise exists
        const institute = await Franchise.findOne({ 
            $or: [
                { instituteID: franchiseId },
                { _id: franchiseId }
            ]
        });

        if (!institute) {
            return { valid: false, error: "Institute not found." };
        }

        // If courseId is provided, validate that the course belongs to this franchise
        if (courseId) {
            const course = await Course.findOne({ 
                _id: courseId,
                franchiseId: institute.instituteID 
            });

            if (!course) {
                return { valid: false, error: "Course not found or you don't have access to this course." };
            }

            return { valid: true, institute, course };
        }

        return { valid: true, institute };
    } catch (error) {
        console.error("Error validating franchise access:", error);
        return { valid: false, error: "Error validating access." };
    }
};

// Get all courses filtered by franchiseId
export const getCourses = async (req, res) => {
    try { 
        const { franchiseId } = req.query;
        console.log("franchiseId value :: ", franchiseId);
        // Build the query object
        let query = {};
        if (franchiseId) {
            query.franchiseId = franchiseId;
        }
         
        const courses = await Course.find(query).select(
            'courseName courseCode courseFees courseMRP courseDuration instituteStatus adminApprovalStatus courseImage courseSubject createdAt updatedAt courseMaterials courseVideoLinks franchiseId' // Added franchiseId to selection
        );
        
        // console.log("courses data for franchiseId:", franchiseId, courses); 
        res.status(200).json(courses);
    } catch (error) {
        console.error("Error fetching courses:", error);
        res.status(500).json({ error: error.message });
    }
};

//Get courses count
export const getCoursesCount = async (req , res) => {
    try {
        const { franchiseId } = req.query;
        console.log("franchiseId value :: ", franchiseId)
    if (!franchiseId) {
      return res.status(400).json({ message: "Franchise ID is required" });
    }
        const count = await Course.countDocuments({franchiseId , adminApprovalStatus: "approved"});
       console.log("getting the count of franchiseID" , count)
        res.status(200).json({ count });
      } catch (error) {
        res.status(500).json({ message: "Error fetching course count", error });
      }
}

// Get recently added courses
export const getRecentCourses = async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 5;
      const franchiseId = req.query.franchiseId; // Get franchiseId from query params
      console.log(req.query, "Query params for recent courses");
      const courses = await Course.find({franchiseId: franchiseId})
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("courseName courseCode courseDuration courseSubject courseMRP instituteStatus adminApprovalStatus courseImage createdAt");
      
      if (courses.length === 0) {
        return res.status(404).json({ message: "No courses found" });
      }
       
      const formattedCourses = courses.map(course => ({
        id: course._id,
        name: course.courseName,
        code: course.courseCode,
        subject: course.courseSubject,
        duration: course.courseDuration, 
        price: course.courseMRP,
        instituteStatus: course.instituteStatus,
        adminApprovalStatus: course.adminApprovalStatus,
        imageUrl: course.courseImage,
        addedOn: course.createdAt
      }));
      
      res.status(200).json(formattedCourses);
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  };

// Update an existing course by ID (with fra    nchise validation)
export const updateCourseById = asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const {
        courseFees, courseMRP, courseDuration, courseVideoLinks,
        courseSyllabus, courseEligibility, instituteStatus,
        franchiseId, // Add franchiseId to destructuring
        // existingCourseImage, // Handled by checking if new courseImage is uploaded
    } = req.body; // courseCode, courseName, courseSubject are not updatable from form

    console.log("Updating course :: ", courseId, "Body:", req.body);
    console.log("Files received for update :: ", req.files);

    // Build query to find course by ID and optionally by franchiseId for security
    let findQuery = { _id: courseId };
    if (franchiseId) {
        findQuery.franchiseId = franchiseId;
    }

    const courseToUpdate = await Course.findOne(findQuery);
    if (!courseToUpdate) {
        return res.status(404).json({ 
            error: franchiseId ? "Course not found or you don't have permission to update this course" : "Course not found" 
        });
    }

    const updates = {};
    if (courseFees !== undefined) updates.courseFees = Number(courseFees);
    if (courseMRP !== undefined) updates.courseMRP = Number(courseMRP);
    if (courseDuration !== undefined) updates.courseDuration = Number(courseDuration);
    if (courseSyllabus !== undefined) updates.courseSyllabus = courseSyllabus;
    if (courseEligibility !== undefined) updates.courseEligibility = courseEligibility;
    if (instituteStatus !== undefined) updates.instituteStatus = instituteStatus;
    
    // Don't allow updating franchiseId through this endpoint for security
    // if (franchiseId !== undefined) updates.franchiseId = franchiseId;
    
    if (courseVideoLinks !== undefined) {
        try {
            const parsedVideos = JSON.parse(courseVideoLinks);
            updates.courseVideoLinks = parsedVideos.filter(v => v.title && v.link);
        } catch (e) {
            console.warn("Could not parse courseVideoLinks for update:", e.message);
        }
    }

    if (req.files && req.files.courseImage && req.files.courseImage[0]) {
        const imageFile = req.files.courseImage[0];
        const uploadedImage = await uploadOnCloudinary(imageFile.path);
        if (uploadedImage && uploadedImage.url) {
            updates.courseImage = uploadedImage.url;
        } else {
            console.error("Cloudinary image upload failed for update or URL not found", uploadedImage);
        }
    } else if (req.body.existingCourseImage) { // If frontend signals to keep existing image
        updates.courseImage = req.body.existingCourseImage;
    } else if (!req.body.existingCourseImage && !req.files?.courseImage) { 
      // If it's edit mode, no existing image was sent to be kept, and no new one uploaded, means remove.
      updates.courseImage = ""; // Set to empty string to remove
    }

    let finalProcessedCourseMaterials = [];
    const materialsDataFromFrontend = req.body.courseMaterials ? JSON.parse(req.body.courseMaterials) : [];
    let newFilesUploadIndex = 0;

    for (const materialInfo of materialsDataFromFrontend) {
        if (materialInfo.type === 'link') {
            if (materialInfo.url && materialInfo.title) {
                finalProcessedCourseMaterials.push({
                    title: materialInfo.title,
                    type: 'link',
                    url: materialInfo.url,
                    fileName: materialInfo.fileName || materialInfo.title,
                    fileType: materialInfo.fileType || 'external-link',
                    thumbnailUrl: materialInfo.thumbnailUrl,
                    _id: materialInfo._id // Preserve _id if it's an existing material
                });
            }
        } else if (materialInfo.type === 'file') {
            if (materialInfo.isNewFile) { // Placeholder for a new file
                if (req.files && req.files.courseMaterialFiles && req.files.courseMaterialFiles[newFilesUploadIndex]) {
                    const materialFile = req.files.courseMaterialFiles[newFilesUploadIndex];
                    const uploadedMaterial = await uploadOnCloudinary(materialFile.path);
                    if (uploadedMaterial && uploadedMaterial.url) {
                        finalProcessedCourseMaterials.push({
                            title: materialInfo.title || materialFile.originalname,
                            type: 'file',
                            url: uploadedMaterial.url,
                            fileName: materialFile.originalname,
                            fileType: materialFile.mimetype,
                        });
                    }
                    newFilesUploadIndex++;
                }
            } else if (materialInfo.url) { // Existing file to keep
                finalProcessedCourseMaterials.push({
                    title: materialInfo.title,
                    type: 'file',
                    url: materialInfo.url,
                    fileName: materialInfo.fileName,
                    fileType: materialInfo.fileType,
                    thumbnailUrl: materialInfo.thumbnailUrl,
                     _id: materialInfo._id
                });
            }
        }
    }
    updates.courseMaterials = finalProcessedCourseMaterials;

    // Use the same query for update to ensure franchise ownership
    const updatedCourse = await Course.findOneAndUpdate(
        findQuery, 
        { $set: updates }, 
        { new: true, runValidators: true }
    );

    if (!updatedCourse) {
        return res.status(404).json({ error: "Course not found or update failed" });
    }
    
    const message = 'Course updated successfully.';
    res.status(200).json({ message, course: updatedCourse });
});

// Get a single course by ID
export const getCourseById = asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }
    res.status(200).json(course);
});

// Add a new note/material to a specific course
export const addNoteToCourse = asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    
    // console.log("[addNoteToCourse] req.body:", req.body);
    // console.log("[addNoteToCourse] req.files:", req.files);

    console.log("franchiseId in addNoteToCourse:", req.body.franchiseId);
    const { title, type, url: linkUrl, franchiseId, } = req.body; 

    if (!title || !type) {
        console.error("[addNoteToCourse] Missing title or type in req.body", req.body);
        return res.status(400).json({ error: "Title and Type are required for a note." });
    }

    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    let newNote;

    if (type === 'link') {
        if (!linkUrl) { // Title is already checked above
            return res.status(400).json({ error: "URL is required for link type notes." });
        }
        newNote = {
            title, type: 'link', url: linkUrl, fileType: 'external-link', franchiseId,
        };
    } else if (type === 'file') {
        if (!req.files || !req.files.noteFile || req.files.noteFile.length === 0) {
            return res.status(400).json({ error: "File is required for file type notes." });
        }
        const noteFile = req.files.noteFile[0];
        const uploadedFile = await uploadOnCloudinary(noteFile.path);


        if (!uploadedFile || !uploadedFile.url) {
            console.error("Cloudinary upload failed for note file:", noteFile.originalname, uploadedFile);
            return res.status(500).json({ error: "Failed to upload file to Cloudinary." });
        }
        newNote = {
            title: title || noteFile.originalname, type: 'file', url: uploadedFile.url,
            fileName: noteFile.originalname, fileType: noteFile.mimetype, franchiseId,
        };
    } else {
        return res.status(400).json({ error: "Invalid note type specified." });
    }

    // console.log("[addNoteToCourse] Constructed newNote:", newNote);
    // Ensure existing materials are valid before pushing and saving
    const validExistingMaterials = [];
    if (course.courseMaterials && Array.isArray(course.courseMaterials)) {
        course.courseMaterials.forEach(material => {
            let currentTitle = material.title || material.fileName || 'Untitled Material';
            let currentType = material.type;
            let currentUrl = material.url;

            if (!currentType) currentType = (material.fileName && currentUrl) ? 'file' : (currentUrl ? 'link' : 'file');
            if (!currentUrl) currentUrl = "placeholder_url"; // Should not happen if schema enforced
            
            validExistingMaterials.push({
                title: currentTitle, type: currentType, url: currentUrl,
                fileName: material.fileName, fileType: material.fileType, 
                thumbnailUrl: material.thumbnailUrl, _id: material._id, franchiseId: material.franchiseId
            });
        });
    }
    
    validExistingMaterials.push(newNote);
    course.courseMaterials = validExistingMaterials;

    console.log("[addNoteToCourse] course.courseMaterials AFTER processing and push:", JSON.stringify(course.courseMaterials, null, 2));
    
    await course.save();
    res.status(201).json({ message: "Note added successfully to course.", course });
});

// Add a new video link to a specific course
export const addVideoLinkToCourse = asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const { title, link, franchiseId } = req.body;

    if (!title || !link) {
        return res.status(400).json({ error: "Title and Link are required for a video." });
    }

    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    const newVideoLink = { title, link, franchiseId };

    course.courseVideoLinks.push(newVideoLink);
    
    await course.save();
    res.status(201).json({ message: "Video link added successfully to course.", course });
});

// Delete a specific video from a course
export const deleteVideoFromCourse = asyncHandler(async (req, res) => {
    const { courseId, videoId } = req.params;
    const { franchiseId } = req.body;

    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    // Validate franchise access if franchiseId is provided
    if (franchiseId && course.franchiseId !== franchiseId) {
        return res.status(403).json({ error: "You don't have permission to modify this course" });
    }

    // Find and remove the video
    const videoIndex = course.courseVideoLinks.findIndex(video => video._id.toString() === videoId);
    if (videoIndex === -1) {
        return res.status(404).json({ error: "Video not found in this course" });
    }

    course.courseVideoLinks.splice(videoIndex, 1);
    await course.save();

    res.status(200).json({ message: "Video deleted successfully from course.", course });
});


// Delete a specific note/material from a course 
export const deleteNoteFromCourse = asyncHandler(async (req, res) => {
    const { courseId, noteId } = req.params;
    const { franchiseId } = req.body;

    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({ error: "Course not found" });
    }

    // Validate franchise access if franchiseId is provided
    if (franchiseId && course.franchiseId !== franchiseId) {
        return res.status(403).json({ error: "You don't have permission to modify this course" });
    }

    // Find the note to delete
    const noteIndex = course.courseMaterials.findIndex(material => material._id.toString() === noteId);
    if (noteIndex === -1) {
        return res.status(404).json({ error: "Note not found in this course" });
    }

    const noteToDelete = course.courseMaterials[noteIndex];

    // If it's a file (especially PDF) stored on Cloudinary, delete it from Cloudinary
    if (noteToDelete.type === 'file' && noteToDelete.url) {
        const deleteResult = await deleteFromCloudinary(noteToDelete.url);
        if (deleteResult.success) {
            console.log("File deleted from Cloudinary successfully");
        } else {
            console.warn("Could not delete file from Cloudinary:", deleteResult.message || deleteResult.error);
            // Continue with database deletion even if Cloudinary deletion fails
        }
    }

    // Remove the note from the course
    course.courseMaterials.splice(noteIndex, 1);
    await course.save();

    res.status(200).json({ message: "Note deleted successfully from course.", course });
});